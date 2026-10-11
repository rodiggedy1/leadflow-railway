import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUSTOMER_MISSIONS,
  MESSAGE_CATEGORIES,
  MISSION_STATES,
  NEXT_BEST_ACTIONS,
  filterCurrentTurnFactObservations,
  normalizeShadowPrediction,
} from "./madisonMessageUnderstanding";
import { validateMadisonDecision } from "./madisonDecisionPolicy";

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
      factObservations: [{ factKey: "requested_date", value: "2026-10-10", evidenceExcerpt: "Saturday October 10th" }],
      extractionStatus: "COMPLETE",
      extractionQualityNote: null,
    }, { model: "gemini-3.5-flash-lite" });

    expect(prediction).toMatchObject({
      primaryCategory: "SERVICE_ISSUE",
      categories: ["SERVICE_ISSUE", "REFUND_CREDIT_REQUEST"],
      mission: "CUSTOMER_CARE",
      missionState: "PARTIALLY_RESOLVED",
      nextBestAction: "CREATE_REVIEW_TASK",
      confidence: 0.93,
      classifierVersion: "madison-shadow-v1",
      model: "gemini-3.5-flash-lite",
    });
    expect(prediction.factObservations).toEqual([{ factKey: "requested_date", value: "2026-10-10", evidenceExcerpt: "Saturday October 10th", sourceMessageId: undefined }]);
    expect(prediction.extractionStatus).toBe("COMPLETE");
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
    expect(prediction.factObservations).toEqual([]);
    expect(prediction.extractionStatus).toBe("NO_FACTS_PRESENT");
  });

  it("adapts valid OpenAI JSON-object aliases without heuristic extraction", () => {
    const prediction = normalizeShadowPrediction({
      category: "AVAILABILITY_REQUEST",
      mission: "PROVIDE_TEAM_STATUS",
      missionState: "NEW",
      nextAction: "CHECK_AVAILABILITY",
      factObservations: [
        { key: "requested_date", value: "October 15th", evidenceExcerpt: "October 15th" },
        { key: "excluded_teams", value: ["Onilda", "JessiCleaning"], evidenceExcerpt: "outside of Onilda and JessiCleaning" },
      ],
      extractionStatus: "COMPLETE",
    }, { model: "gpt-5.5" });

    expect(prediction.primaryCategory).toBe("AVAILABILITY_REQUEST");
    expect(prediction.mission).toBe("PROVIDE_TEAM_STATUS");
    expect(prediction.nextBestAction).toBe("CHECK_AVAILABILITY");
    expect(prediction.factObservations).toEqual([
      { factKey: "requested_date", value: "October 15th", evidenceExcerpt: "October 15th", sourceMessageId: undefined },
      { factKey: "excluded_teams", value: "Onilda, JessiCleaning", evidenceExcerpt: "outside of Onilda and JessiCleaning", sourceMessageId: undefined },
    ]);
    expect(prediction.model).toBe("gpt-5.5");
  });

  it("keeps historical-only facts out of the current fact ledger", () => {
    const facts = [
      { factKey: "requested_date", value: "October 15th", evidenceExcerpt: "October 15th", sourceMessageId: undefined },
      { factKey: "refund_item", value: "mat", evidenceExcerpt: "refund of the mat", sourceMessageId: undefined },
    ];

    expect(filterCurrentTurnFactObservations(
      facts,
      "Good morning, are there any cleaning teams available for October 15th, outside of Onilda and JessiCleaning? I'd prefer a different team."
    )).toEqual([{ ...facts[0], sourceActorRole: "customer" }]);
  });

  it("accepts grounded normalized evidence paraphrases without accepting historical facts", () => {
    const facts = [
      { factKey: "requested_service", value: "house cleaning", evidenceExcerpt: "house cleaning", sourceMessageId: undefined },
      { factKey: "refund_item", value: "mat", evidenceExcerpt: "refund of the mat", sourceMessageId: undefined },
    ];
    expect(filterCurrentTurnFactObservations(
      facts,
      "Are you able to clean our house tomorrow?",
      "customer",
      "msg-current",
    )).toEqual([{ ...facts[0], sourceMessageId: "msg-current", sourceActorRole: "customer" }]);
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

  it("keeps the strict nested fact schema and explicit reschedule examples aligned", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/madisonMessageUnderstanding.ts"),
      "utf8"
    );
    expect(source).toContain('required: ["factKey", "value", "evidenceExcerpt", "sourceMessageId"]');
    expect(source).toContain('speechAct: { type: "string", enum: [...SPEECH_ACTS] }');
    expect(source).toContain('"speechAct", "confidence"');
    expect(source).toContain('For “Can you reschedule please”, return at least one factObservation');
    expect(source).toContain('For “Can we reschedule to tomorrow morning then?”, return separate factObservations');
    expect(source).toContain('For “Can you change my booking to monthly”, return separate factObservations');
    expect(source).toContain('Never fold an explicit frequency, recurrence, service type, date, time, or constraint into the requested_action value');
  });

  it("does not make shadow predictions part of Madison execution", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/madisonSmsAgent.ts"),
      "utf8"
    );
    expect(source).toContain("persistMadisonMessageShadow");
    expect(source).toContain("await persistMadisonMessageShadow");
    expect(source).not.toContain("shadowPrediction.nextBestAction");
    expect(source).not.toContain("executeShadowAction");
  });

  it("requires the deterministic policy diagnostics to remain observational", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/madisonDecisionPolicy.ts"),
      "utf8"
    );
    expect(source).toContain('validatorVersion: "madison-decision-policy-v2"');
    expect(source).toContain("allowedNextActions");
    expect(source).toContain("blockedActions");
    expect(source).toContain("modelProposedAction");
    expect(source).toContain("finalAction");
    expect(source).toContain("policyContractValid");
    expect(source).toContain("SPEECH_ACT_MISSION_CONFLICT");
    expect(source).not.toContain("persistMadisonMessageShadow");
    expect(source).not.toContain("sendSms");
  });

  it("keeps Shadow persistence failure stages separate from the Madison draft lifecycle", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/madisonMessageUnderstanding.ts"),
      "utf8"
    );
    const agentSource = readFileSync(
      resolve(process.cwd(), "server/madisonSmsAgent.ts"),
      "utf8"
    );
    expect(source).toContain('stage: "classifier" | "persistence"');
    expect(source).toContain('stage: "persisted"');
    expect(agentSource).toContain("shadowResult.stage");
    expect(agentSource).toContain('errorStage: `shadow_${shadowResult.stage}`');
  });

  it("preserves the GPT proposal but overrides a blocked sensitive action", () => {
    const prediction = normalizeShadowPrediction({
      primaryCategory: "CANCELLATION_REQUEST",
      categories: ["CANCELLATION_REQUEST"],
      mission: "CANCEL_BOOKING",
      missionState: "READY_FOR_REVIEW",
      nextBestAction: "RESOLVE_BOOKING",
      speechAct: "REQUEST",
      confidence: 0.95,
      knownFacts: [],
      missingFacts: [],
      factObservations: [{ factKey: "requested_action", value: "cancel", evidenceExcerpt: "cancel" }],
      extractionStatus: "COMPLETE",
      extractionQualityNote: null,
    });
    const diagnostics = validateMadisonDecision(prediction, "Please cancel");

    expect(diagnostics.modelProposedAction).toBe("RESOLVE_BOOKING");
    expect(diagnostics.finalAction).toBe("HOLD_FOR_HUMAN");
    expect(diagnostics.actionOverridden).toBe(true);
    expect(diagnostics.policyContractValid).toBe(true);
    expect(diagnostics.blockedActions).toContain("RESOLVE_BOOKING");
    expect(diagnostics.reasonCodes).toContain("MODEL_ACTION_BLOCKED");
  });

  it("fails closed without rewriting an invalid policy contract", () => {
    const prediction = normalizeShadowPrediction({
      primaryCategory: "AMBIGUOUS",
      categories: ["AMBIGUOUS"],
      mission: "UNRESOLVED",
      missionState: "UNRESOLVED",
      nextBestAction: "RESOLVE_BOOKING",
      speechAct: "AMBIGUOUS",
      confidence: 0.2,
      knownFacts: [],
      missingFacts: [],
      factObservations: [],
      extractionStatus: "PARTIAL",
      extractionQualityNote: null,
    });
    const diagnostics = validateMadisonDecision(prediction, "What?");
    expect(diagnostics.finalAction).toBe("HOLD_FOR_HUMAN");
    expect(diagnostics.policyContractValid).toBe(true);
    expect(diagnostics.modelProposedAction).toBe("RESOLVE_BOOKING");
    expect(diagnostics.reasonCodes).toContain("MODEL_ACTION_NOT_ALLOWED");
  });
});
