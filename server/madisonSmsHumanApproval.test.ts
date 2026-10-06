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
    expect(approvalCardBlock).toContain("draft: reviewDraft");
  });

  it("keeps the quote flow inside human approval", () => {
    expect(source).not.toContain('approvedBy: "madison_auto_quote"');
    expect(source).not.toContain("AUTO-SENT quote flow reply");
    expect(source).toContain("Quote replies and every other substantive generated draft remain DRAFT_READY");
  });

  it("records a human edit before sending without replacing Madison's original draft", () => {
    const approvalSource = readFileSync(resolve(process.cwd(), "server/opsChatRouter.ts"), "utf8");
    const schemaSource = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const approvalBlock = approvalSource.slice(approvalSource.indexOf("approveSmsDraft"), approvalSource.indexOf("dismissSmsDraft"));
    expect(approvalBlock).toContain("madisonSmsDraftEdits");
    expect(approvalBlock).toContain("originalText: draft.generatedDraft");
    expect(approvalBlock).toContain("editedText: input.approvedText");
    expect(approvalBlock).toContain("editedBy: input.approvedBy");
    expect(schemaSource).toContain("generatedDraft: text(\"generatedDraft\")");
  });

  it("exposes edit and approve-edited controls on the AI Team card", () => {
    const reviewSource = readFileSync(resolve(process.cwd(), "client/src/pages/AiTeamReview.tsx"), "utf8");
    expect(reviewSource).toContain("Edit reply");
    expect(reviewSource).toContain("Approve edited reply");
    expect(reviewSource).toContain("Original Madison draft is preserved.");
  });
});
