import { describe, expect, it } from "vitest";
import { SERVICE_AGREEMENT_SMS } from "../shared/csServiceAgreement";

describe("SERVICE_AGREEMENT_SMS", () => {
  it("preserves the approved Satisfaction Guarantee message and destination", () => {
    expect(SERVICE_AGREEMENT_SMS).toContain("Satisfaction Guarantee");
    expect(SERVICE_AGREEMENT_SMS).toContain("Just scroll to the bottom and tap acknowledge");
    expect(SERVICE_AGREEMENT_SMS).toContain("https://maids-in-black-guarantee.rohangilkes2.chatgpt.site");
  });
});
