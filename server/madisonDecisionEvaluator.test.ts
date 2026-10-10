import { describe, expect, it } from "vitest";
import { evaluateMadisonDecision, getMadisonConfidenceBand } from "./madisonDecisionEvaluator";

const base = {
  policyMode: "approval_required" as const,
  policyEnabled: true,
  targetResolution: "partial" as const,
  requiredFactsPresent: false,
  missingFacts: ["booking_reference"],
  currentStateVerified: true,
  now: new Date("2026-10-09T19:00:00.000Z"),
};

describe("Madison confidence-aware decision evaluator", () => {
  it("uses explicit confidence bands", () => {
    expect(getMadisonConfidenceBand(0.69)).toBe("low");
    expect(getMadisonConfidenceBand(0.7)).toBe("medium");
    expect(getMadisonConfidenceBand(0.9)).toBe("high");
  });

  it("allows a grounded support task to reach human approval", () => {
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95 })).toMatchObject({
      confidenceBand: "high",
      outcome: "ready_for_human_approval",
      reasonCodes: ["manual_target_lookup_may_be_required", "review_missing_facts"],
    });
  });

  it("routes low confidence to clarification", () => {
    expect(evaluateMadisonDecision({ ...base, confidence: 0.5 })).toMatchObject({
      confidenceBand: "low",
      outcome: "clarification_required",
    });
  });

  it("blocks disabled, suggest-only, automatic, and unresolved policies", () => {
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95, policyEnabled: false }).outcome).toBe("blocked_policy_disabled");
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95, policyMode: "suggest_only" }).outcome).toBe("recommendation_only");
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95, policyMode: "automatic" }).outcome).toBe("blocked_confidence");
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95, targetResolution: "unresolved" }).outcome).toBe("blocked_unresolved_target");
  });

  it("fails closed for malformed or out-of-range confidence", () => {
    expect(evaluateMadisonDecision({ ...base, confidence: "not-a-number" })).toMatchObject({ confidence: 0, outcome: "clarification_required" });
    expect(evaluateMadisonDecision({ ...base, confidence: 2 }).confidence).toBe(1);
    expect(evaluateMadisonDecision({ ...base, confidence: -1 }).confidence).toBe(0);
  });
});
