import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutApprovedSmsBookingQuote } from "./smsBookingQuoteSourceControl";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = "b1bf3cff91be631ec7a38e2675a28993ebd3e1d6";
const current = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const before = (file: string) => execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 5_000_000 });

describe("SMS booking quote additive boundaries — offline source control", () => {
  it.each([
    "server/instinct/claudeCustomerSms.ts", "server/instinct/claudeCustomerSmsApplication.ts",
    "server/instinct/claudeCustomerSmsGeneration.ts", "server/instinct/claudeCustomerTasksStore.ts",
  ])("allows only the fixed authorized SMS hunks and preserves every other byte: %s", file => {
    expect(withoutApprovedSmsBookingQuote(file, current(file))).toBe(before(file));
    expect(withoutApprovedSmsBookingQuote(file, current(file) + "\n// UNAUTHORIZED_CHANGE\n")).not.toBe(before(file));
  });

  it.each([
    "server/vapiService.ts", "server/vapiWebhook.ts", "server/instinct/callBookingQuote.ts",
    "server/instinct/callBookingQuoteStore.ts",
    "server/customerBookingLinkService.ts", "server/bookingFunnelRouter.ts", "shared/publicBookingPricing.ts",
    "server/openphone.ts", "server/webhooks.ts", "server/instinct/claudeAgentClient.ts",
    "server/instinct/claudeSmsAlternative.ts", "server/instinct/claudeCustomerEmailApplication.ts",
    "server/instinct/claudeCustomerEmail.ts", "server/instinct/claudeCustomerEmailStore.ts", "drizzle/schema.ts",
    "shared/claudeCustomerTasks.ts", "client/src/components/ClaudeCustomerTasks.tsx",
    "client/src/components/claude-customer-tasks.css", "client/src/pages/CommandChatExactLive.tsx",
    "client/src/pages/command-chat-exact-live.css",
  ])("preserves protected source byte-for-byte: %s", file => {
    expect(current(file)).toBe(before(file));
  });

  it("allows only moving the existing call formatter into the shared passive presentation module", () => {
    const file = "server/instinct/callBookingQuoteApplication.ts", original = before(file);
    const start = original.indexOf("const money = "), end = original.indexOf("type Store = ");
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const expected = (original.slice(0, start) + "\n" + original.slice(end))
      .replace('import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";\n',
        'import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";\n'
        + 'import { buildCallBookingQuoteSms } from "./bookingQuotePresentation";\n'
        + 'export { buildCallBookingQuoteSms } from "./bookingQuotePresentation";\n');
    expect(current(file)).toBe(expected);
    expect(current(file) + "\n// UNAUTHORIZED_CHANGE\n").not.toBe(expected);
  });

  it("allows only extracting the exact existing booking follow-up wording; the call task branch is otherwise identical", () => {
    const file = "server/instinct/callBookingQuoteTask.ts", original = before(file);
    const helper = '/** Shared task wording only; task persistence and completion remain canonical. */\n'
      + 'export function appendBookingQuoteFollowup(task: ProposedCustomerTask | null, evidenceQuote: string): ProposedCustomerTask {\n'
      + '  const title = "Follow up on cleaning booking link";\n'
      + '  const item = { title: "Review the customer\'s booking-link completion", evidenceQuote };\n'
      + '  if (!task) return { title, items: [item] };\n'
      + '  return { ...task, items: [...task.items, item] };\n}\n\n';
    const oldBody = '    const title = "Follow up on cleaning booking link";\n'
      + '    const item = { title: "Review the customer\'s booking-link completion", evidenceQuote };\n'
      + '    if (!task) return { title, items: [item] };\n'
      + '    return { ...task, items: [...task.items, item] };';
    const source = current(file);
    expect(source.split(helper)).toHaveLength(2);
    expect(source.replace(helper, "").replace('    return appendBookingQuoteFollowup(task, evidenceQuote);', oldBody)).toBe(original);
  });

  it("retains the complete shared email generator, prompts and exact SMS conversation validation", () => {
    const file = "server/instinct/claudeCustomerSmsGeneration.ts";
    const marker = "export function createClaudeCustomerSmsGenerator(";
    expect(current(file).split(marker)[0]).toBe(before(file).split(marker)[0]);
    const body = (source: string) => source.slice(source.indexOf("    const originalConversation = exactConversation(binding, sessionSnapshot);"));
    expect(body(current(file))).toBe(body(before(file)));
  });

  it("preserves existing task persistence, claim, checklist, required-note completion and acceptance exactly", () => {
    const file = "server/instinct/claudeCustomerTasksStore.ts", now = current(file), old = before(file);
    const prefix = (source: string) => source.slice(source.indexOf("export function createClaudeCustomerTaskPersistence()"), source.indexOf("/** Passive factory:"));
    expect(prefix(now)).toBe(prefix(old));
    const tail = (source: string) => source.slice(source.indexOf("    recordAcceptance: (claim, providerMessageId)"));
    expect(tail(now)).toBe(tail(old));
    expect(now.indexOf("!await fresh(tx, claim.binding)")).toBeLessThan(now.indexOf("await options.preparePlan?.(tx, claim, rawPlan)"));
    expect(now).toContain("customerReplyPlanSchema.parse(preparedPlan ?? rawPlan)");
  });

  it("installs qualification only in the already-eligible automatic SMS application", () => {
    const app = current("server/instinct/claudeCustomerSmsApplication.ts");
    expect(app.indexOf('return { outcome: "excluded"')).toBeLessThan(app.indexOf('import("./smsBookingQuoteGeneration")'));
    expect(app).toContain("smsBookingQuote: { readState: quoteStore.read }");
    expect(app).toContain("preparePlan: createSmsBookingQuotePlanPreparer");
    expect(app).toContain("send: sendSms");
    expect(app.indexOf("await taskStore.prepare(claim, plan)")).toBeLessThan(app.indexOf('broadcastOpsUpdate("booking_funnel_update")'));
  });
});
