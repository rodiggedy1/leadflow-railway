import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const baseline = "e762068d01118d8b4a6ea54f64d04b9546abc012";
const removedCodes = ["UNSAFE_REPLY_CLAIM", "UNSAFE_REPLY_PRESENTATION", "ACKNOWLEDGMENT_REQUIRES_TASK"];
const sources = [
  { path: "server/instinct/claudeSmsAlternative.ts", checks: 4 },
  { path: "server/instinct/claudeCustomerSmsGeneration.ts", checks: 2 },
  { path: "server/instinct/claudeInitialLead.ts", checks: 2 },
  { path: "server/instinct/smsBookingQuoteGeneration.ts", checks: 1 },
];
function before(path: string): string {
  return execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" });
}
// This historical audit still verifies the exact deployed phrase deletions.
// Only the full pinned recovery candidate is normalized; any additional byte fails.
// generationRecoveryScope independently checks these pins and unchanged prompts.
const recoveryHashes: Record<string, string> = {
  "server/instinct/claudeSmsAlternative.ts": "a9f2e906787cfda63d32a9d9612e7b0a7b8555d1ee2249ba8698dd3947979ee6",
  "server/instinct/claudeCustomerSmsGeneration.ts": "b43266dd5bc761a9e4647cfedc1d0a3131d008325ea217cfa2fbc41394011596",
  "server/instinct/claudeInitialLead.ts": "2e33c4f9d5aeb307517fe5ed5ed5ff0fa439e2f2115d27444a8a0b96da4cc391",
  "server/instinct/smsBookingQuoteGeneration.ts": "303e0a7f38d7c5e3e33eedc0874be028b88e50c18fb7a5e67530a132fb5e85e0",
};
// Token trim (2026-11-25): reviewed knowledge-placement change on top of the pinned candidate above.
const tokenTrimHashes: Record<string, string> = {
  "server/instinct/claudeCustomerSmsGeneration.ts": "1c9dd8b5e8f2ebe0cffa7994f9527254ee69b3029e36c53cccc7cb076aed320f",
};
function phraseRemovalSource(path: string): string {
  const source = readFileSync(path, "utf8"), hash = createHash("sha256").update(source).digest("hex");
  return hash === recoveryHashes[path] || hash === tokenTrimHashes[path]
    ? execFileSync("git", ["show", `d277178315602808dbc1ac141bc344761f6f4468:${path}`], { encoding: "utf8" }) : source;
}
function expectedAfter(path: string, source: string): string {
  if (path.endsWith("smsBookingQuoteGeneration.ts")) {
    const start = source.indexOf("// These checks apply ONLY to active quote text");
    const end = source.indexOf("function templateNeutralText(", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    return (source.slice(0, start) + source.slice(end))
      .replace("    assertNoBookingCompletion(plan.replyText);\n", "")
      .replace("      assertNoBookingCompletion(neutral);\n", "")
      .replace("      // generator checks its stricter completion and pending-task guards too.",
        "      // generator checks its strict schema and current-inbound task evidence too.");
  }
  const comments = path.endsWith("claudeSmsAlternative.ts") ? [
    "  // Conservative visible schema failure, not a synthetic fallback or claim that",
    "  // offline tests establish semantic grounding for every possible model output.",
    "  // Timezone wording is a prompt preference, never a reason to discard a reply.",
  ] : path.endsWith("claudeCustomerSmsGeneration.ts") ? [
    "    // Additional capability-specific failures, not synthetic rewrites. Current",
    "    // CS tone examples include completed actions; none occurred in generation.",
  ] : [];
  return source.split("\n").filter(line => !comments.includes(line)
    && !removedCodes.some(code => line.includes(`return fail("${code}")`))).join("\n");
}

describe("authorized reply phrase-check removal has no replacement or unrelated runtime edits", () => {
  it.each(sources)("removes only the approved rejection checks from $path", ({ path, checks }) => {
    const original = before(path), actual = phraseRemovalSource(path);
    expect(original.split("\n").filter(line => removedCodes.some(code => line.includes(`return fail("${code}")`)))).toHaveLength(checks);
    expect(actual).toBe(expectedAfter(path, original));
    for (const code of removedCodes) expect(actual).not.toContain(code);
    expect(actual + "\n// UNAUTHORIZED_CHANGE\n").not.toBe(expectedAfter(path, original));
  });
  it("keeps quote state, pricing, templates and the existing syntax-only recovery intact", () => {
    const path = "server/instinct/smsBookingQuoteGeneration.ts", actual = phraseRemovalSource(path);
    for (const marker of [
      "smsBookingQuoteStateSchema.parse(loaded)", "SMS_QUOTE_STATE_IDENTITY_MISMATCH",
      "advanceSmsBookingQuote(previous, update", "assertNoQuotePriceOrUrl(plan.replyText)",
      "assertNoQuotePriceOrUrl(neutral)", "SMS_QUOTE_TEMPLATE_INCOMPLETE", "SMS_QUOTE_TEMPLATE_LINK_COUNT",
      "if (!(error instanceof SyntaxError) || options.signal?.aborted) throw error;",
      "const secondOutput = await runner(request);",
    ]) expect(actual).toContain(marker);
    expect(actual).not.toContain("assertNoBookingCompletion");
  });
  it("keeps strict output and current-inbound task evidence without requiring a task for wording", () => {
    const actual = phraseRemovalSource("server/instinct/claudeCustomerSmsGeneration.ts");
    expect(actual).toContain("customerReplyPlanSchema.parse(JSON.parse(output.finalSmsText))");
    expect(actual).toContain('return fail("TASK_EVIDENCE_NOT_CURRENT_INBOUND")');
    expect(actual).not.toContain("plan.task === null &&");
    const shared = readFileSync("server/instinct/claudeSmsAlternative.ts", "utf8");
    expect(shared).toContain("claudeSmsAlternativeReplySchema.parse(JSON.parse(text))");
  });
  it("leaves all source files owning booking state, payments, routing, duplicate and delivery protections byte-identical", () => {
    for (const path of [
      "server/instinct/claudeCustomerSms.ts", "server/instinct/claudeCustomerSmsApplication.ts",
      "server/instinct/claudeCustomerTasksStore.ts", "server/instinct/claudeCustomerSmsManualGuard.ts",
      "server/instinct/claudeThumbtackFirstResponse.ts", "server/instinct/claudeThumbtackFirstResponseStore.ts",
      "server/instinct/claudeThumbtackFirstResponseApplication.ts", "server/instinct/smsBookingQuote.ts",
      "server/instinct/smsBookingQuoteStore.ts", "server/instinct/smsBookingQuoteApplication.ts",
      "server/instinct/bookingQuotePresentation.ts", "server/instinct/smsBookingQuoteMissingQuestion.ts",
      "server/instinct/smsBookingQuoteSendSchema.ts", "server/instinct/claudeAgentClient.ts",
      "server/openphone.ts", "server/webhooks.ts", "server/thumbtackWebhook.ts", "server/thumbtackWebhookCapture.ts",
      "server/customerBookingLinkService.ts", "server/bookingFunnelRouter.ts",
      "server/internalBookingHandoffCard.ts", "server/csReplyStream.ts", "server/knowledgeBase.ts",
      "server/madisonKnowledgeRetrieval.ts", "shared/publicBookingPricing.ts", "shared/bookingFunnel.ts",
      "shared/claudeCustomerTasks.ts", "shared/claudeSmsAlternative.ts", "shared/claudeInitialLead.ts",
    ]) expect(readFileSync(path, "utf8"), path).toBe(before(path));
  });
});
