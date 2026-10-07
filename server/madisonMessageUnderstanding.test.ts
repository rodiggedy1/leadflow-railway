import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUSTOMER_MISSIONS,
  MESSAGE_CATEGORIES,
  MISSION_STATES,
  NEXT_BEST_ACTIONS,
  normalizeShadowPrediction,
  deterministicShadowPrediction,
} from "./madisonMessageUnderstanding";

describe("Madison Message Understanding shadow contract", () => {
  it("normalizes an expanded multi-layer prediction into controlled values", () => {
    const prediction = normalizeShadowPrediction({
      primaryCategory: "SERVICE_ISSUE",
      categories: ["SERVICE_ISSUE", "REFUND_CREDIT_REQUEST"],
      mission: "CUSTOMER_CARE",
      missionState: "PARTIALLY_RESOLVED",
      nextBestAction: "CREATE_REVIEW_TASK",
      confidence: 0.93,
      knownFacts: ["existing booking"],
      missingFacts: ["issue resolution"],
    });

    expect(prediction).toMatchObject({
      primaryCategory: "SERVICE_ISSUE",
      categories: ["SERVICE_ISSUE", "REFUND_CREDIT_REQUEST"],
      mission: "CUSTOMER_CARE",
      missionState: "PARTIALLY_RESOLVED",
      nextBestAction: "CREATE_REVIEW_TASK",
      confidence: 0.93,
      classifierVersion: "madison-shadow-v1",
    });
  });

  it("falls back to safe review values for malformed model output", () => {
    const prediction = normalizeShadowPrediction({
      primaryCategory: "not-a-category",
      categories: ["not-a-category"],
      mission: "not-a-mission",
      missionState: "not-a-state",
      nextBestAction: "send_sms",
      confidence: 4,
      knownFacts: ["valid", 3],
      missingFacts: "not-an-array",
    });

    expect(prediction.primaryCategory).toBe("AMBIGUOUS");
    expect(prediction.categories).toEqual(["AMBIGUOUS"]);
    expect(prediction.mission).toBe("UNRESOLVED");
    expect(prediction.missionState).toBe("UNRESOLVED");
    expect(prediction.nextBestAction).toBe("HOLD_FOR_HUMAN");
    expect(prediction.confidence).toBe(1);
    expect(prediction.knownFacts).toEqual(["valid"]);
    expect(prediction.missingFacts).toEqual([]);
  });

  it("keeps the taxonomy finite and includes the agreed operational categories", () => {
    expect(MESSAGE_CATEGORIES).toEqual(
      expect.arrayContaining([
        "RESCHEDULE_REQUEST",
        "CANCELLATION_REQUEST",
        "SERVICE_ISSUE",
        "PAYMENT_QUESTION",
        "PAYMENT_ISSUE",
        "ETA_REQUEST",
        "NEW_BOOKING",
        "CONFIRMATION",
        "CASUAL_ACKNOWLEDGMENT",
        "QUOTE_REQUEST",
        "AMBIGUOUS",
      ])
    );
    expect(CUSTOMER_MISSIONS).toContain("BOOK_SERVICE");
    expect(MISSION_STATES).toContain("PARTIALLY_RESOLVED");
    expect(NEXT_BEST_ACTIONS).toContain("HOLD_FOR_HUMAN");
  });

  it("records an obvious cancellation without depending on the shadow LLM", () => {
    expect(
      deterministicShadowPrediction("Hi, can you cancel my booking?")
    ).toMatchObject({
      primaryCategory: "CANCELLATION_REQUEST",
      mission: "CANCEL_BOOKING",
      missionState: "READY_FOR_REVIEW",
      nextBestAction: "CREATE_REVIEW_TASK",
      confidence: 0.99,
    });
  });

  it("does not turn ordinary operational text into a cancellation prediction", () => {
    expect(
      deterministicShadowPrediction("He will be there in 30 mins")
    ).toBeNull();
  });

  it("does not make shadow predictions part of Madison execution", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/madisonSmsAgent.ts"),
      "utf8"
    );
    expect(source).toContain("persistMadisonMessageShadow");
    expect(source).toContain("void persistMadisonMessageShadow");
    expect(source).not.toContain("shadowPrediction.nextBestAction");
    expect(source).not.toContain("executeShadowAction");
  });
});
