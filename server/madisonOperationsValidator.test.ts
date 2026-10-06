import { describe, expect, it } from "vitest";
import {
  madisonActionProposalSchema,
  madisonDecisionSchema,
  madisonDispositionSchema,
  madisonIntentTypeSchema,
} from "@shared/madisonOperations";
import {
  createMadisonActionFingerprint,
  validateMadisonReadiness,
} from "./madisonOperationsValidator";

const target = {
  customerId: "customer-1",
  bookingId: "booking-1",
  occurrenceKey: "2026-10-08",
  resolutionStatus: "RESOLVED" as const,
  resolutionNotes: [],
};

const runtime = {
  modelProvider: "built-in",
  modelName: "configured-default",
  modelVersion: null,
  promptVersion: "sms-operations-v1",
  schemaVersion: "decision-v1",
  validatorVersion: "operations-validator-v1",
};

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalKey: "proposal-1",
    actionType: "RESCHEDULE_BOOKING" as const,
    operation: "CHANGE_DATE" as const,
    parameters: { requestedDate: "2026-10-08" },
    target,
    riskLevel: 2 as const,
    readiness: "READY_FOR_HUMAN_REVIEW" as const,
    missingParameters: [],
    verificationSteps: ["Confirm booking", "Check availability"],
    requiresHumanApproval: true as const,
    expectedCurrentState: { serviceDate: "2026-10-07" },
    bookingVersion: "booking-updated-at-1",
    actionFingerprint: "a".repeat(64),
    status: "PROPOSED" as const,
    ...overrides,
  };
}

describe("Madison Phase 0 contracts", () => {
  it("accepts strict disposition and intent enum values", () => {
    expect(madisonDispositionSchema.parse("ACTION_REQUIRED")).toBe("ACTION_REQUIRED");
    expect(madisonIntentTypeSchema.parse("CANCEL_BOOKING")).toBe("CANCEL_BOOKING");
    expect(madisonDispositionSchema.safeParse("cancel please").success).toBe(false);
    expect(madisonIntentTypeSchema.safeParse("CANCEL").success).toBe(false);
  });

  it("accepts a multi-intent decision with one action proposal per operational intent", () => {
    const result = madisonDecisionSchema.safeParse({
      decisionId: "decision-1",
      sourceMessageId: "openphone-message-1",
      sessionId: "session-1",
      customerId: "customer-1",
      summary: "Customer wants to move the booking and add an oven cleaning.",
      disposition: "ACTION_REQUIRED",
      reply: {
        recommended: true,
        draft: "I will check the requested change and confirm the details.",
      },
      intents: [
        {
          intentKey: "intent-date",
          type: "MODIFY_BOOKING",
          confidence: 0.94,
          evidence: ["Customer requested a different date."],
          uncertainties: [],
          target,
          request: {
            operation: "CHANGE_DATE",
            requestedDate: "2026-10-08",
            requestedTime: null,
            requestedOutcome: null,
            requestedScope: "ONE_OCCURRENCE",
          },
          actionProposal: proposal(),
        },
        {
          intentKey: "intent-extra",
          type: "SERVICE_REQUEST",
          confidence: 0.91,
          evidence: ["Customer requested inside oven cleaning."],
          uncertainties: [],
          target,
          request: {
            operation: "ADD_EXTRA",
            requestedDate: null,
            requestedTime: null,
            requestedOutcome: "Inside oven",
            requestedScope: "ONE_OCCURRENCE",
          },
          actionProposal: proposal({
            proposalKey: "proposal-2",
            actionType: "OTHER_OPERATION",
            operation: "ADD_EXTRA",
            parameters: { extra: "inside oven" },
            actionFingerprint: "b".repeat(64),
          }),
        },
      ],
      uncertainties: [],
      contextUsed: [
        {
          kind: "latest_message",
          id: "openphone-message-1",
          summary: "Latest inbound customer SMS",
        },
      ],
      runtime,
      createdAt: "2026-10-06T04:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("requires human approval on every action proposal", () => {
    const result = madisonActionProposalSchema.safeParse(
      proposal({ requiresHumanApproval: false })
    );
    expect(result.success).toBe(false);
  });
});

describe("Madison readiness validation", () => {
  it("reports missing parameters before a proposal is ready", () => {
    expect(
      validateMadisonReadiness({
        targetResolutionStatus: "RESOLVED",
        missingParameters: ["requestedDate", "requestedDate"],
      })
    ).toEqual({
      readiness: "MISSING_PARAMETERS",
      missingParameters: ["requestedDate"],
    });
  });

  it("reports unresolved targets before policy or completeness checks", () => {
    expect(
      validateMadisonReadiness({
        targetResolutionStatus: "PARTIAL",
        missingParameters: [],
        policyReviewRequired: true,
      }).readiness
    ).toBe("TARGET_UNRESOLVED");
  });

  it("reports conflicting state before declaring readiness", () => {
    expect(
      validateMadisonReadiness({
        targetResolutionStatus: "RESOLVED",
        currentStateConflicts: true,
      }).readiness
    ).toBe("CONFLICTING_STATE");
  });

  it("returns ready only when target, policy, and parameters pass", () => {
    expect(
      validateMadisonReadiness({
        targetResolutionStatus: "RESOLVED",
        missingParameters: [],
        policyReviewRequired: false,
        currentStateConflicts: false,
      })
    ).toEqual({
      readiness: "READY_FOR_HUMAN_REVIEW",
      missingParameters: [],
    });
  });
});

describe("Madison action fingerprints", () => {
  const base = {
    customerId: "customer-1",
    bookingId: "booking-1",
    occurrenceKey: "2026-10-08",
    actionType: "RESCHEDULE_BOOKING",
    operation: "CHANGE_DATE",
    parameters: { requestedDate: "2026-10-08", requestedTime: null },
    sourceMessageId: "message-1",
  };

  it("is stable when object keys are supplied in a different order", () => {
    const first = createMadisonActionFingerprint(base);
    const second = createMadisonActionFingerprint({
      ...base,
      parameters: { requestedTime: null, requestedDate: "2026-10-08" },
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when a stable proposal identity field changes", () => {
    const original = createMadisonActionFingerprint(base);
    const changedDate = createMadisonActionFingerprint({
      ...base,
      parameters: { requestedDate: "2026-10-09", requestedTime: null },
    });
    const changedMessage = createMadisonActionFingerprint({
      ...base,
      sourceMessageId: "message-2",
    });

    expect(changedDate).not.toBe(original);
    expect(changedMessage).not.toBe(original);
  });
});
