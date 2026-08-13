import { describe, expect, it, vi } from "vitest";
import {
  getConfiguredCsPhoneNumberIds,
  getCsOutboundDeliveryRecipient,
  isEligibleRecentCsSession,
  reconcileSessionBatch,
  RECOVERY_BATCH_LIMIT,
} from "./quoOutboundReconciliation";

describe("Quo outbound reconciliation gates", () => {
  const companyNumbers = getConfiguredCsPhoneNumberIds(["cs-number", "leads-number"]);

  it("accepts only outgoing delivery events from configured company numbers", () => {
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "cs-number", to: ["302-981-6191"] }, companyNumbers)).toBe("+13029816191");
    expect(getCsOutboundDeliveryRecipient({ direction: "incoming", phoneNumberId: "cs-number", to: ["302-981-6191"] }, companyNumbers)).toBeNull();
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "other-number", to: ["302-981-6191"] }, companyNumbers)).toBeNull();
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "cs-number" }, companyNumbers)).toBeNull();
  });

  it("selects only unresolved recent CS-source sessions for recovery", () => {
    const now = Date.now();
    const base = { id: 1, leadPhone: "+13029816191", leadSource: "cs-inbound", csResolvedAt: null, lastMessageTs: now - 1_000 };
    expect(isEligibleRecentCsSession(base, now)).toBe(true);
    expect(isEligibleRecentCsSession({ ...base, csResolvedAt: new Date() }, now)).toBe(false);
    expect(isEligibleRecentCsSession({ ...base, leadSource: "website" }, now)).toBe(false);
    expect(isEligibleRecentCsSession({ ...base, lastMessageTs: now - 49 * 60 * 60 * 1000 }, now)).toBe(false);
  });

  it("records actual merges, no-ops, and errors without writing beyond the existing importer", async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce({ added: 2, newestOutboundTs: Date.now() })
      .mockResolvedValueOnce({ added: 0, newestOutboundTs: null })
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const wait = vi.fn().mockResolvedValue(undefined);
    const result = await reconcileSessionBatch([
      { id: 1, leadPhone: "+13029816191" },
      { id: 2, leadPhone: "+12025550100" },
      { id: 3, leadPhone: "+17035550100" },
    ], sync, wait);
    expect(result).toEqual({ scanned: 3, mergedMessages: 2, errors: 1 });
    expect(sync).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("keeps the scheduled batch limit bounded", () => {
    expect(RECOVERY_BATCH_LIMIT).toBe(20);
  });
});
