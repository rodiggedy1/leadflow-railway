import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeSmsConfidence } from "./smsConfidenceRouter";

describe("SMS confidence evaluator", () => {
  it("requires the strict simulated quality threshold without changing send behavior", () => {
    expect(normalizeSmsConfidence({
      confidence: 97.9,
      wouldSendIfAllTopicsAllowed: true,
      category: "follow_up",
      rationale: "The reply is grounded in the conversation.",
      flags: [],
    })).toMatchObject({ confidence: 98, wouldSendIfAllTopicsAllowed: false });

    expect(normalizeSmsConfidence({
      confidence: 98,
      wouldSendIfAllTopicsAllowed: true,
      category: "follow_up",
      rationale: "The reply is grounded in the conversation.",
      flags: [],
    })).toMatchObject({ confidence: 98, wouldSendIfAllTopicsAllowed: true });

    expect(normalizeSmsConfidence({
      confidence: 97.4,
      wouldSendIfAllTopicsAllowed: true,
      category: "follow_up",
      rationale: "The reply needs a human review.",
      flags: [],
    })).toMatchObject({ confidence: 97, wouldSendIfAllTopicsAllowed: false });

    expect(normalizeSmsConfidence({
      confidence: 100,
      wouldSendIfAllTopicsAllowed: true,
      category: "follow_up",
      rationale: "The reply needs a human review.",
      flags: ["unsupported_fact"],
    })).toMatchObject({ confidence: 100, wouldSendIfAllTopicsAllowed: false });
  });

  it("clamps malformed model confidence to a safe display range", () => {
    expect(normalizeSmsConfidence({ confidence: 999 })).toMatchObject({ confidence: 100, wouldSendIfAllTopicsAllowed: false });
    expect(normalizeSmsConfidence({ confidence: -8 })).toMatchObject({ confidence: 0, wouldSendIfAllTopicsAllowed: false });
  });

  it("has no delivery, persistence, migration, or shared-stream dependency", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "smsConfidenceRouter.ts"), "utf8");

    for (const forbidden of ["sendSms", "openphone", "getDb", "drizzle", "Express", "csReplyStream", "migration"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("opsChatProcedure");
    expect(source).toContain("invokeLLM");
  });
});
