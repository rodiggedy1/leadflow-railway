import { describe, expect, it } from "vitest";
import { automaticClaudeSmsProvenance, claudeDraftSourceSchema, reviewedClaudeSmsProvenance, smsSenderLabel } from "../shared/smsSenderProvenance";
const requestId = "00112233-4455-4677-8899-aabbccddeeff";
const source = { requestId, kind: "initial_lead" as const };

describe("internal SMS provenance labels", () => {
  it("labels only a server-created automatic marker bound to this exact provider message", () => {
    const message = { role: "assistant", content: "Original customer-facing text", senderName: "Madison", opMsgId: "OM-exact",
      smsProvenance: automaticClaudeSmsProvenance(71, "OM-exact") };
    expect(smsSenderLabel(message, "Rohan")).toBe("Claude AI · Automatic");
    expect(message.content).toBe("Original customer-facing text");
    expect(message.senderName).toBe("Madison");
    expect(smsSenderLabel({ ...message, opMsgId: "different" }, "Rohan")).toBe("Madison");
    expect(smsSenderLabel({ ...message, opMsgId: undefined }, "Rohan")).toBe("Madison");
  });
  it.each(["initial_lead", "sms_reply"] as const)("keeps actual human sender and identifies %s drafting assistance", kind => {
    const smsProvenance = reviewedClaudeSmsProvenance({ requestId, kind }, "Actual Staff");
    expect(smsSenderLabel({ role: "assistant", senderName: "Actual Staff", smsProvenance }, "Rohan")).toBe("Actual Staff · Claude draft");
    expect(smsSenderLabel({ role: "assistant", smsProvenance }, "Different Viewer")).toBe("Actual Staff · Claude draft");
  });
  it("retains the saved human sender over viewer or metadata names", () => {
    expect(smsSenderLabel({ role: "assistant", senderName: "Rohan", smsProvenance: reviewedClaudeSmsProvenance(source, "Other name") }, "Viewer")).toBe("Rohan · Claude draft");
  });
  it.each([undefined, null, {}, { generator: "claude" }, { version: 2, generator: "claude", mode: "automatic" },
    { version: 1, generator: "openai", mode: "automatic" }, { version: 1, generator: "claude", mode: "automatic", workflow: "thumbtack_first_response", receiptId: 0, providerMessageId: "OM-exact" }])("never guesses Claude authorship from invalid/absent metadata %#", smsProvenance => {
    expect(smsSenderLabel({ role: "assistant", senderName: "Rohan", opMsgId: "OM-exact", smsProvenance }, "Viewer")).toBe("Rohan");
  });
  it.each(["Rohan", "Madison", "Instinct", "Claude AI"])("never relabels old untagged history based on sender name %s", senderName => {
    expect(smsSenderLabel({ role: "assistant", senderName }, "Viewer")).toBe(senderName);
  });
  it.each(["user", "note", "system"])("ignores attribution on %s messages", role => {
    expect(smsSenderLabel({ role, senderName: "Customer", opMsgId: "OM-exact", smsProvenance: automaticClaudeSmsProvenance(71, "OM-exact") }, "Viewer")).toBe("Customer");
  });
  it("never accepts client-supplied automatic or reviewer claims as human draft input", () => {
    expect(claudeDraftSourceSchema.safeParse({ ...source, mode: "automatic" }).success).toBe(false);
    expect(claudeDraftSourceSchema.safeParse({ ...source, reviewedBy: "Fake Staff" }).success).toBe(false);
    expect(claudeDraftSourceSchema.safeParse({ ...source, smsProvenance: automaticClaudeSmsProvenance(71, "OM-exact") }).success).toBe(false);
    expect(reviewedClaudeSmsProvenance({ requestId: "bad", kind: "initial_lead" }, "Staff")).toBeNull();
    expect(reviewedClaudeSmsProvenance(source, "")).toBeNull();
    expect(reviewedClaudeSmsProvenance(source, null)).toBeNull();
  });
  it("does not mutate any input while formatting", () => {
    const message = { role: "assistant", senderName: "Rohan", smsProvenance: reviewedClaudeSmsProvenance(source, "Rohan") };
    const before = JSON.stringify(message); smsSenderLabel(message, "Viewer"); expect(JSON.stringify(message)).toBe(before);
  });
});
