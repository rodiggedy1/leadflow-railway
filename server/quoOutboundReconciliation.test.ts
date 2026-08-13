import { describe, expect, it, vi } from "vitest";
import {
  getConfiguredCsPhoneNumberIds,
  getCsOutboundDeliveryRecipient,
} from "./quoOutboundReconciliation";

describe("Quo outbound reconciliation gates", () => {
  const companyNumbers = getConfiguredCsPhoneNumberIds(["PN0wVLcpCq", "PNRNABf0MC"]);

  it("accepts only outgoing delivery events from configured company numbers", () => {
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "PN0wVLcpCq", to: ["302-981-6191"] }, companyNumbers)).toBe("+13029816191");
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "PNRNABf0MC", to: "+12025550100" }, companyNumbers)).toBe("+12025550100");
    expect(getCsOutboundDeliveryRecipient({ direction: "incoming", phoneNumberId: "PN0wVLcpCq", to: ["302-981-6191"] }, companyNumbers)).toBeNull();
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "PNO7yagqfm", to: ["302-981-6191"] }, companyNumbers)).toBeNull();
    expect(getCsOutboundDeliveryRecipient({ direction: "outgoing", phoneNumberId: "PN0wVLcpCq" }, companyNumbers)).toBeNull();
  });
});
