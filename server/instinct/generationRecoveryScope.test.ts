import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const baseline = "d277178315602808dbc1ac141bc344761f6f4468";
const before = (path: string) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" });
const sha = (source: string) => createHash("sha256").update(source).digest("hex");
const candidates: Record<string, string> = {
  // Token trim (2026-11-25): knowledge base kept only in the fixed instructions; email payload slimmed.
  "server/instinct/claudeCustomerSmsGeneration.ts": "1c9dd8b5e8f2ebe0cffa7994f9527254ee69b3029e36c53cccc7cb076aed320f",
  "server/instinct/claudeCustomerEmailApplication.ts": "4bcf1aa8fe5c79ec1963724cc2bc1b5c0a99bdcd2b7bdf015e3252de43e6cfd1", // + history window (2026-11-25)
  "server/instinct/smsBookingQuoteGeneration.ts": "303e0a7f38d7c5e3e33eedc0874be028b88e50c18fb7a5e67530a132fb5e85e0",
  "server/instinct/claudeInitialLead.ts": "2e33c4f9d5aeb307517fe5ed5ed5ff0fa439e2f2115d27444a8a0b96da4cc391",
  "server/instinct/claudeSmsAlternative.ts": "a9f2e906787cfda63d32a9d9612e7b0a7b8555d1ee2249ba8698dd3947979ee6",
  "server/instinct/generationRecovery.ts": "17aa260660577dcc59c5d99f1d7d24e765205f82cb3885620b6580a7b395e3ea",
};
const protectedSources = [
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
  "server/instinct/claudeCustomerEmail.ts",
  "server/instinct/claudeCustomerEmailGuards.ts", "server/instinct/claudeCustomerEmailStore.ts",
];
function initializer(source: string, path: string, name: string): string {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer)
      matches.push(source.slice(node.initializer.getStart(tree), node.initializer.end));
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(matches).toHaveLength(1); return matches[0];
}

describe("one-extra-generation recovery exact local scope", () => {
  it.each(Object.entries(candidates))("pins all reviewed candidate bytes and rejects an additional edit: %s", (path, hash) => {
    const source = readFileSync(path, "utf8");
    expect(sha(source)).toBe(hash);
    expect(sha(source + "\n// UNAUTHORIZED_CHANGE\n")).not.toBe(hash);
    expect(source).not.toMatch(/\b(?:sendSms|setInterval|setTimeout)\s*\(|\bdb\.(?:insert|update|delete)\s*\(/);
  });
  // Owner-approved reviewed changes to protected files: exact new bytes pinned; any further edit still fails.
  const reviewedProtected: Record<string, string> = {
    // Inbox query (2026-11-26): inbound paths also store lastCustomerMessageTs.
    "server/webhooks.ts": "ed56fa0cad016d1e37e9f620aac010f87b794885d709cec5388825be9fb93f24",
    // History window (2026-11-25): reads saved bookings and unfinished tasks as optional SMS context.
    // Messages API (2026-11-26): automatic SMS replies ask for the 1-hour cache (cacheTtl: "1h"); nothing else changed.
    "server/instinct/claudeCustomerSmsApplication.ts": "1f2a7582ff1bacd476d6b48d2d59549a9496bc7c799448f78da31609ee4e4d41",
  };
  it.each(protectedSources)("preserves delivery, authority, state, transport and prompts byte-for-byte: %s", path => {
    const source = readFileSync(path, "utf8");
    if (reviewedProtected[path]) { expect(sha(source)).toBe(reviewedProtected[path]); return; }
    expect(source).toBe(before(path));
  });
  it.each([
    ["server/instinct/claudeCustomerSmsGeneration.ts", "CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS"],
    ["server/instinct/claudeCustomerSmsGeneration.ts", "CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS"],
    ["server/instinct/smsBookingQuoteGeneration.ts", "TEMPLATE_INSTRUCTIONS"],
    ["server/instinct/smsBookingQuoteGeneration.ts", "SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS"],
  ])("keeps the exact prompt initializer %s / %s", (path, name) => {
    expect(initializer(readFileSync(path, "utf8"), path, name)).toBe(initializer(before(path), path, name));
  });
  it("preserves the complete original SMS binding and saved-conversation validator", () => {
    const path = "server/instinct/claudeCustomerSmsGeneration.ts";
    const segment = (source: string) => source.slice(source.indexOf("function fail("), source.indexOf("\n/**", source.indexOf("function exactConversation(")));
    expect(segment(readFileSync(path, "utf8"))).toBe(segment(before(path)));
  });
});
