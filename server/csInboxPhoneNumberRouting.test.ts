import { describe, expect, it } from "vitest";
import {
  CS_INBOX_LEGACY_DEFAULT_PHONE_NUMBER_ID,
  getCsInboxReplyPhoneNumberId,
  getCsInboxReplyPhoneNumberIdForSelectedConversation,
  getInboundPhoneNumberId,
} from "../shared/csInboxPhoneNumberRouting";

describe("CsInbox2 source-number reply routing", () => {
  const csNumberId = "PN_CS_NUMBER";
  const leadsNumberId = "PN_LEADS_NUMBER";

  it("replies from the exact CS number that received the inbound SMS", () => {
    expect(getCsInboxReplyPhoneNumberId(getInboundPhoneNumberId(csNumberId))).toBe(csNumberId);
  });

  it("replies from the exact Leads number that received the inbound SMS", () => {
    expect(getCsInboxReplyPhoneNumberId(getInboundPhoneNumberId(leadsNumberId))).toBe(leadsNumberId);
  });

  it("uses the newer inbound number when the same customer later texts another line", () => {
    const firstInbound = getInboundPhoneNumberId(csNumberId);
    const laterInbound = getInboundPhoneNumberId(leadsNumberId);
    expect(getCsInboxReplyPhoneNumberId(firstInbound)).toBe(csNumberId);
    expect(getCsInboxReplyPhoneNumberId(laterInbound)).toBe(leadsNumberId);
  });

  it("preserves the current default for a legacy session with no stored source number", () => {
    expect(getCsInboxReplyPhoneNumberId(null)).toBe(CS_INBOX_LEGACY_DEFAULT_PHONE_NUMBER_ID);
    expect(getInboundPhoneNumberId(undefined)).toBeNull();
  });

  it("uses the newer live inbox source when the selected card snapshot is stale", () => {
    expect(getCsInboxReplyPhoneNumberIdForSelectedConversation(
      { id: 42, lastInboundPhoneNumberId: csNumberId },
      [{ id: 42, lastInboundPhoneNumberId: leadsNumberId }],
    )).toBe(leadsNumberId);
  });

  it("uses the live source when a search-opened selected conversation lacks the field", () => {
    expect(getCsInboxReplyPhoneNumberIdForSelectedConversation(
      { id: 43, lastInboundPhoneNumberId: undefined },
      [{ id: 43, lastInboundPhoneNumberId: leadsNumberId }],
    )).toBe(leadsNumberId);
  });

  it("falls back to the existing default when neither the selected nor live row has a source", () => {
    expect(getCsInboxReplyPhoneNumberIdForSelectedConversation(
      { id: 44, lastInboundPhoneNumberId: null },
      [{ id: 44, lastInboundPhoneNumberId: null }],
    )).toBe(CS_INBOX_LEGACY_DEFAULT_PHONE_NUMBER_ID);
  });
});
