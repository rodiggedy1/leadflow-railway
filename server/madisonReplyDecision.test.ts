import { describe, expect, it } from "vitest";
import { evaluateMadisonDecision } from "./madisonDecisionEvaluator";
import { guardMadisonDraftAgainstUnverifiedBookingChange } from "./madisonReplyDecision";

describe("Madison reply decision safety", () => {
  it("does not confirm a reschedule when the customer has not provided a time", () => {
    expect(guardMadisonDraftAgainstUnverifiedBookingChange({
      inboundText: "Saturday oct 10",
      draft: "Got it, Riz! We'll move your cleaning to Saturday, October 10th.",
      senderName: "Riz Gamela",
    })).toBe("Got it, Riz! I can help with that. What time would work best for you? I’ll check availability before confirming the change.");
  });

  it("preserves a safe clarification draft", () => {
    const draft = "What time would work best for you? I'll check availability before confirming.";
    expect(guardMadisonDraftAgainstUnverifiedBookingChange({
      inboundText: "Saturday oct 10",
      draft,
      senderName: "Riz Gamela",
    })).toBe(draft);
  });

  it("keeps reply decisions explicitly scoped to SMS sending", () => {
    expect(evaluateMadisonDecision({
      actionKey: "send_sms_reply",
      confidence: 0.9,
      confidenceSource: "shadow",
      policyMode: "approval_required",
      policyEnabled: true,
      targetResolution: "partial",
      requiredFactsPresent: false,
      missingFacts: ["specific_request"],
      currentStateVerified: true,
    })).toMatchObject({ actionKey: "send_sms_reply", outcome: "ready_for_human_approval" });
  });

  it("does not permit automatic reply execution", () => {
    expect(evaluateMadisonDecision({
      actionKey: "send_sms_reply",
      confidence: 0.95,
      policyMode: "automatic",
      policyEnabled: true,
      targetResolution: "resolved",
      requiredFactsPresent: true,
      missingFacts: [],
      currentStateVerified: true,
    }).outcome).toBe("blocked_confidence");
  });
});
