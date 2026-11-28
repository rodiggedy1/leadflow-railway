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
  // + history window (2026-11-25); + quality complaint label (Phase 2, 2026-11-28): the same runner, wrapped to add one
  // prompt paragraph in front and to read the optional label from the same answer (no extra AI call; reply unchanged).
  "server/instinct/claudeCustomerEmailApplication.ts": "4aaa736f6cbd8eb8de9985e871dde6c49c0ab44ec8000c0e6624e14b468b7076",
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
    // Receiving-line reliability (2026-11-27): the same single line lookup, time-limited, with one bounded retry
    // for temporary failures (Retry-After respected within 5 s) and the real failure logged; an excluded number logs why.
    "server/instinct/claudeCustomerSmsApplication.ts": "5f79cf866268db8f0bb9687889fd9f28012264c166f3bbd07f2f5f38be8d9e4b",
    // Phase 1 booking changes (2026-11-26): optional bookingAction on the reply plan (never stored in the task) and
    // attaching a proposal to its own private record when the task is created. Nothing else changed.
    // Receiving-line reliability (2026-11-27): reportUnverifiedLineFailure creates the existing failure-review task when
    // the line cannot be verified (opt-out, later reply/text, existing attempt or task: skipped). Never sends.
    // Failure visibility (2026-11-28): a failed attempt's review task is skipped only for an opt-out or a conversation
    // now owned by another phone (no longer for a newer text, a later reply or a changed line); skips return their reason.
    "server/instinct/claudeCustomerTasksStore.ts": "68c26cbb3bdc0fd3817c7cc67731a445da6af177ca44a7c56219e5199a06821c",
    // Receiving-line reliability (2026-11-27): every exclusion logs its rule (decisions unchanged); an unverified line
    // creates the existing review task or keeps the existing owner alert. No generation or send on that path.
    // Failure visibility (2026-11-28): every failure-review outcome is logged (created / skipped with reason / failed, owner
    // alert kept); a claim that fails after the line lookup gets the existing review task on the verified line.
    "server/instinct/claudeCustomerSms.ts": "83ebec215fa74d3ccbbe0ef5b3aa9e6f2b4e33a912d1c8918ce7439b80300d34",
    // Receiving-line reliability (2026-11-27): the guard-decline log line names the declining rule; the guard is unchanged.
    "server/webhooks.ts": "84ee309c9c0caceffe422234184f6c7fc1e3db2da5c5f4c9a52dff8473bc5259",
    "shared/claudeCustomerTasks.ts": "57ce1ad7fefe44da89a92986fdb0fd951029263794a705a383c408ff31972e10",
    // Quality complaint label (Phase 2, 2026-11-28): the SMS generator is given onQualityComplaint, which saves an
    // independently validated label in the background (never awaited, never changes the reply/task/booking/send).
    "server/instinct/claudeCustomerSmsApplication.ts": "00f89bc88e0c7d365ab2e09e311a0cc40c3e417cc6c48c1268b315002b6298e9",
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
