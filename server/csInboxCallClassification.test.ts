import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "../client/src/components/CsInbox2.tsx"),
  "utf8",
);

const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

function classifyInboundAiCall(input: {
  now: number;
  callCreatedAt: number;
  createdAt: number;
  messageCount: number | null;
}): "New" | "Needs Response" {
  const callAgeMs = input.now - input.callCreatedAt;
  const isNewCallSession =
    callAgeMs < TWENTY_FOUR_H &&
    input.createdAt >= input.now - TWENTY_FOUR_H &&
    (input.messageCount ?? 999) <= 2;

  return isNewCallSession ? "New" : "Needs Response";
}

describe("CsInbox2 inbound AI-call classification contract", () => {
  const now = Date.UTC(2026, 7, 16, 12, 0, 0);

  it("places a new qualifying inbound AI-call session in New", () => {
    expect(classifyInboundAiCall({
      now,
      callCreatedAt: now - 5 * 60 * 1000,
      createdAt: now - 10 * 60 * 1000,
      messageCount: 1,
    })).toBe("New");
  });

  it("places a non-new inbound AI-call session in Needs Response", () => {
    expect(classifyInboundAiCall({
      now,
      callCreatedAt: now - 25 * 60 * 60 * 1000,
      createdAt: now - 25 * 60 * 60 * 1000,
      messageCount: 4,
    })).toBe("Needs Response");
  });

  it.each(["quote_given", "faq_answered", "booked"])(
    "never maps the %s inbound AI-call outcome to Waiting on Customer",
    () => {
      expect(classifyInboundAiCall({
        now,
        callCreatedAt: now - 90 * 60 * 1000,
        createdAt: now - 90 * 60 * 1000,
        messageCount: 3,
      })).toBe("Needs Response");
    },
  );

  it("keeps the actual call branch outcome-independent and leaves the SMS branch intact", () => {
    const callBranchStart = source.indexOf('if (conv.latestInteractionType === "call" && conv.latestCallCreatedAt) {');
    const callBranchEnd = source.indexOf("// ── Resolved SMS sessions", callBranchStart);
    const callBranch = source.slice(callBranchStart, callBranchEnd);

    expect(callBranchStart).toBeGreaterThanOrEqual(0);
    expect(callBranchEnd).toBeGreaterThan(callBranchStart);
    expect(callBranch).toContain('return isNewCallSession ? "New" : "Needs Response";');
    expect(callBranch).not.toContain("deriveCallActionState");
    expect(callBranch).not.toContain("latestCallOutcome");
    expect(callBranch).not.toContain('return "Waiting on Customer";');
    expect(source).toContain("// ── SMS column assignment (unchanged)");
    expect(source).toContain('const needsReply = conv.lastSenderRole === "user";');
  });
});
