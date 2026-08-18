import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/madisonSmsAgent.ts"), "utf8");
const phase1Start = source.indexOf("// ── Step 0.5: Phase 1A Deterministic Auto-Reply");
const phase1End = source.indexOf("// ── Step 1: Classify", phase1Start);
const substantiveDraftStart = source.indexOf("// ── Step 7: Persist draft");
const approvalCardStart = source.indexOf("// ── Step 8: Post Draft Card to Command Chat", substantiveDraftStart);

describe("Madison substantive SMS human approval boundary", () => {
  it("keeps the narrow Phase 1A courtesy auto-send path unchanged", () => {
    const phase1Block = source.slice(phase1Start, phase1End);

    expect(phase1Start).toBeGreaterThanOrEqual(0);
    expect(phase1Block).toContain("pickPhase1AResponse(inboundText)");
    expect(phase1Block).toContain("await sendSms({ to: fromPhone, content: phase1aResponse");
    expect(phase1Block).toContain('approvedBy: "madison_auto_template"');
  });

  it("never directly sends an LLM-generated substantive draft", () => {
    const substantiveDraftBlock = source.slice(substantiveDraftStart, approvalCardStart);

    expect(substantiveDraftStart).toBeGreaterThanOrEqual(0);
    expect(substantiveDraftBlock).not.toContain("evaluateAutoSend(");
    expect(substantiveDraftBlock).not.toContain("content: draftResponse.draft");
    expect(source).not.toContain("function evaluateAutoSend");
  });

  it("posts substantive drafts to the existing approval-card flow", () => {
    const approvalCardBlock = source.slice(approvalCardStart, source.indexOf("console.log(`[MadisonSMS] Draft", approvalCardStart));

    expect(approvalCardStart).toBeGreaterThan(substantiveDraftStart);
    expect(approvalCardBlock).toContain("postDraftCardToCommandChat");
    expect(approvalCardBlock).toContain("draft: draftResponse.draft");
  });
});
