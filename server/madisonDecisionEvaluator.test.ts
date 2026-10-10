import { describe, expect, it } from "vitest";
import { evaluateMadisonDecision, getMadisonConfidenceBand } from "./madisonDecisionEvaluator";
import { MADISON_REGRESSION_CASES } from "./madisonEvaluationContracts";

const base = {
  actionKey: "create_support_task" as const,
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

  it("separates missing task facts from confidence and blocks action readiness", () => {
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95 })).toMatchObject({
      confidenceBand: "high",
      outcome: "blocked_missing_facts",
      actionReadiness: "not_ready_missing_information",
      reasonCodes: ["review_missing_facts"],
    });
  });

  it("routes low-confidence actions to insufficient-evidence readiness", () => {
    expect(evaluateMadisonDecision({ ...base, requiredFactsPresent: true, missingFacts: [], confidence: 0.5 })).toMatchObject({
      confidenceBand: "low",
      outcome: "blocked_confidence",
      actionReadiness: "not_ready_insufficient_evidence",
    });
  });

  it("blocks disabled, suggest-only, automatic, and unresolved policies", () => {
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95, policyEnabled: false }).outcome).toBe("blocked_policy_disabled");
    expect(evaluateMadisonDecision({ ...base, requiredFactsPresent: true, missingFacts: [], confidence: 0.95, policyMode: "suggest_only" }).outcome).toBe("recommendation_only");
    expect(evaluateMadisonDecision({ ...base, requiredFactsPresent: true, missingFacts: [], confidence: 0.95, policyMode: "automatic" }).outcome).toBe("blocked_confidence");
    expect(evaluateMadisonDecision({ ...base, confidence: 0.95, targetResolution: "unresolved" }).outcome).toBe("blocked_unresolved_target");
  });

  it("fails closed for malformed or out-of-range confidence", () => {
    expect(evaluateMadisonDecision({ ...base, requiredFactsPresent: true, missingFacts: [], confidence: "not-a-number" })).toMatchObject({ confidence: null, outcome: "blocked_confidence" });
    expect(evaluateMadisonDecision({ ...base, confidence: 2 }).confidence).toBe(1);
    expect(evaluateMadisonDecision({ ...base, confidence: -1 }).confidence).toBe(0);
  });

  it("does not convert missing Shadow data into zero-confidence reply readiness", () => {
    const result = evaluateMadisonDecision({
      actionKey: "send_sms_reply",
      predictionState: "legacy_missing",
      policyMode: "approval_required",
      policyEnabled: true,
      targetResolution: "partial",
      requiredFactsPresent: false,
      missingFacts: ["requested_date"],
      currentStateVerified: false,
    });

    expect(result.confidence).toBeNull();
    expect(result.confidenceBand).toBeNull();
    expect(result.replyReadiness).toBe("reviewable");
    expect(result.outcome).toBe("ready_for_human_approval");
    expect(result.reasonCodes).toContain("prediction_legacy_missing");
  });

  it("ships the initial labeled regression contract before golden-data calibration", () => {
    expect(MADISON_REGRESSION_CASES.length).toBeGreaterThanOrEqual(30);
    expect(MADISON_REGRESSION_CASES.length).toBeLessThanOrEqual(50);
    expect(new Set(MADISON_REGRESSION_CASES.map(testCase => testCase.expectedReplyReadiness)).size).toBeGreaterThan(1);
    expect(MADISON_REGRESSION_CASES.some(testCase => testCase.extractionStatus === "not_available")).toBe(true);
    expect(MADISON_REGRESSION_CASES.some(testCase => testCase.taskCompleteness === "conflicting_for_next_step")).toBe(true);
  });
});
