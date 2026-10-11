import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateGoldenDataset,
  scoreGoldenCase,
  summarizeGoldenResults,
} from "./madisonGoldenDataset";
import type { MadisonShadowPrediction } from "./madisonMessageUnderstanding";

describe("Madison Golden Dataset evaluation system", () => {
  it("contains exactly 40 development and 10 held-out unapproved candidates", () => {
    const dataset = JSON.parse(readFileSync(resolve(process.cwd(), "golden-dataset/candidates.json"), "utf8"));
    expect(validateGoldenDataset(dataset)).toEqual([]);
    expect(dataset.scenarios).toHaveLength(50);
    expect(dataset.scenarios.filter((scenario: any) => scenario.split === "development")).toHaveLength(40);
    expect(dataset.scenarios.filter((scenario: any) => scenario.split === "held_out")).toHaveLength(10);
    expect(dataset.scenarios.every((scenario: any) => scenario.approvalState === "candidate_unreviewed")).toBe(true);
    expect(dataset.scenarios.every((scenario: any) => scenario.expected.intentCategory === null)).toBe(true);
  });

  it("scores facts by normalized key/value and requires valid current-message evidence", () => {
    const expected = {
      intentCategory: "RESCHEDULE_REQUEST",
      mission: "MODIFY_BOOKING",
      facts: [
        { factKey: "requested_action", normalizedValue: "reschedule", evidenceExcerpt: "reschedule" },
        { factKey: "requested_date", normalizedValue: "tomorrow", evidenceExcerpt: "tomorrow" },
      ],
      extractionCompleteness: "COMPLETE" as const,
      taskCompleteness: "PARTIAL",
      missingInformation: ["exact time"],
      conflictingInformation: [],
      targetResolutionState: "WAITING_CUSTOMER",
      replyReadiness: "READY" as const,
      actionReadiness: "NOT_READY" as const,
      forbiddenOperationalActions: ["do not reschedule"],
    };
    const actual: MadisonShadowPrediction = {
      primaryCategory: "RESCHEDULE_REQUEST",
      categories: ["RESCHEDULE_REQUEST"],
      mission: "MODIFY_BOOKING",
      missionState: "WAITING_CUSTOMER",
      nextBestAction: "ASK_CUSTOMER",
      confidence: 0.9,
      knownFacts: [],
      missingFacts: ["exact time"],
      factObservations: [
        { factKey: "requested_action", value: "reschedule", evidenceExcerpt: "reschedule" },
        { factKey: "requested_date", value: "tomorrow", evidenceExcerpt: "tomorrow" },
      ],
      extractionStatus: "COMPLETE",
      extractionQualityNote: null,
      model: "gpt-4o",
      classifierVersion: "madison-shadow-v1",
    };
    const score = scoreGoldenCase(expected, actual);
    expect(score).toMatchObject({
      intentAccuracy: 1,
      missionAccuracy: 1,
      factPrecision: 1,
      factRecall: 1,
      evidenceValidity: 1,
      extractionCompletenessAccuracy: 1,
    });
  });

  it("does not permit accuracy claims when cases are unapproved", () => {
    const summary = summarizeGoldenResults([
      { caseId: "MADISON-001", status: "unscored_unapproved" },
      { caseId: "MADISON-002", status: "unscored_unapproved" },
    ]);
    expect(summary.scoredCases).toBe(0);
    expect(summary.unscoredUnapprovedCases).toBe(2);
    expect(summary.accuracyClaimAllowed).toBe(false);
  });

  it("keeps the runner observational and out of the production persistence path", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/madison-golden-evaluate.ts"), "utf8");
    expect(source).toContain("classifyMadisonMessageShadow");
    expect(source).not.toContain("persistMadisonMessageShadow");
    expect(source).not.toContain("sendSms");
    expect(source).not.toContain("approveSmsDraft");
    expect(source).not.toContain("madisonConversationFactEvents");
  });
});
