import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildShadowPreflight, selectShadowDecision } from "./smsShadowMode";

const source = readFileSync(resolve(process.cwd(), "server/smsShadowMode.ts"), "utf8");

const safeVerifier = {
  confidence: 0.99,
  safeToSimulate: true,
  category: "compliment_acknowledgement",
  reasonCode: "high_confidence_courtesy",
  rationale: "This is a simple acknowledgement with no operational commitment.",
  flags: [],
};

describe("SMS shadow mode", () => {
  it("simulates a high-confidence courtesy acknowledgement without sending it", () => {
    const preflight = buildShadowPreflight("Thank you, the team did an amazing job!", "Thank you so much — we are so glad you loved the clean!");
    const decision = selectShadowDecision(preflight, safeVerifier);

    expect(decision.decision).toBe("would_send");
    expect(decision.score).toBe(99);
    expect(decision.reasonCode).toBe("high_confidence_courtesy");
    expect(source).toContain('app.post("/api/sms-shadow-evaluations"');
    expect(source).not.toContain("sendSms(");
    expect(source).not.toContain('from "./openphone"');
  });

  it("blocks high-impact messages before an LLM verifier can simulate an automatic send", () => {
    const preflight = buildShadowPreflight("Can you reschedule my appointment?", "Absolutely, we will move your appointment.");
    const decision = selectShadowDecision(preflight, safeVerifier);

    expect(preflight.hardStops).toContain("inbound:reschedule");
    expect(decision.decision).toBe("blocked");
    expect(decision.reasonCode).toBe("high_impact_topic");
    expect(decision.verifier).toBeNull();
  });

  it("keeps questions in human review even when the verifier would otherwise approve", () => {
    const preflight = buildShadowPreflight("Thank you? That was thoughtful.", "Thank you so much — we are glad you are happy!");
    const decision = selectShadowDecision(preflight, safeVerifier);

    expect(preflight.inboundQuestion).toBe(true);
    expect(decision.decision).toBe("review");
    expect(decision.reasonCode).toBe("question_requires_human_review");
  });

  it("records an outcome only after the existing human send succeeds", () => {
    const smsPage = readFileSync(resolve(process.cwd(), "client/src/pages/SmsExactLive.tsx"), "utf8");

    expect(smsPage).toContain("const recordShadowOutcome = useCallback");
    expect(smsPage).toContain("sendMessage.mutate(");
    expect(smsPage).toContain("recordShadowOutcome(insertedEvaluation.evaluationId, selected.id, sentText)");
    expect(smsPage).toContain('fetch("/api/sms-shadow-evaluations"');
    expect(smsPage).toContain('aria-label="SMS shadow-mode decision"');
    expect(smsPage).toContain("Shadow mode · no auto-send");
  });
});
