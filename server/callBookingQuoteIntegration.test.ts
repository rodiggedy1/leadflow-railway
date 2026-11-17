import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { callBookingQuoteServerToken } from "./instinct/callBookingQuote";
const mock = vi.hoisted(() => ({ execute: vi.fn(async () => ({ success: true })), getQuote: vi.fn(() => ({ price: 100 })), notify: vi.fn(), getDb: vi.fn(async () => null) }));
vi.mock("./instinct/callBookingQuoteApplication", () => ({ executeCallBookingQuoteTool: mock.execute }));
vi.mock("./vapiService", () => ({ handleGetQuote: mock.getQuote, handleCreateLead: vi.fn(), handleSendSms: vi.fn(), handleScheduleCallback: vi.fn(), handleLookupCustomer: vi.fn(), handleRescheduleRequest: vi.fn(), handleCancelRequest: vi.fn(), handleComplaintRequest: vi.fn(), handleRequestEtaCall: vi.fn(), processEndOfCallReport: vi.fn(async () => {}) }));
vi.mock("./_core/env", () => ({ ENV: { vapiPrivateKey: "offline-vapi-key" } }));
vi.mock("./_core/notification", () => ({ notifyOwner: mock.notify }));
vi.mock("./openphone", () => ({ sendSms: vi.fn() }));
vi.mock("./db", () => ({ getDb: mock.getDb }));
import { registerVapiWebhookRoute } from "./vapiWebhook";
const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const baseline = (path: string) => execFileSync("git", ["show", `f168a07c986a992020dac74e8c52fce4c268b689:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 5_000_000 });
async function call(tool: any, token?: string) {
  let handler: any;
  registerVapiWebhookRoute({ post: (_path: string, fn: any) => { handler = fn; } } as any);
  let response: any;
  const res: any = { status: () => res, json: (value: any) => { response = value; return value; } };
  await handler({ headers: token === undefined ? {} : { "x-instinct-call-quote-token": token }, body: { message: { type: "tool-calls", call: { id: "synthetic-inbound-call", customer: { number: "+13015550123" } }, toolCallList: [tool] } } }, res);
  return response;
}

describe("call-only canonical quote integration — offline", () => {
  it.each([undefined, "", "incorrect"])("rejects new quote execution without correct dedicated authentication (%s)", async token => {
    mock.execute.mockClear();
    const result = await call({ id: "tool-1", name: "textBookingQuote", parameters: {} }, token);
    expect(JSON.parse(result.results[0].result).code).toBe("UNAUTHORIZED_CALL_QUOTE");
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it.each(["getBookingQuote", "textBookingQuote"])("dispatches only authenticated %s with exact call/tool identity", async name => {
    mock.execute.mockClear();
    const args = { synthetic: true };
    const result = await call({ id: "tool-2", name, parameters: args }, callBookingQuoteServerToken("offline-vapi-key"));
    expect(mock.execute).toHaveBeenCalledWith({ callId: "synthetic-inbound-call", toolCallId: "tool-2", name, args });
    expect(JSON.parse(result.results[0].result).success).toBe(true);
  });
  it("preserves OpenAI-style argument parsing for the new tool", async () => {
    mock.execute.mockClear();
    await call({ id: "tool-3", function: { name: "getBookingQuote", arguments: '{"pricing":{"serviceId":"deep"}}' } }, callBookingQuoteServerToken("offline-vapi-key"));
    expect(mock.execute.mock.calls[0][0].args).toEqual({ pricing: { serviceId: "deep" } });
  });
  it("does not apply new authentication to existing call tools", async () => {
    mock.getQuote.mockClear();
    const result = await call({ id: "old-tool", name: "getQuote", parameters: { bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", serviceType: "Standard Cleaning" } });
    expect(mock.getQuote).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.results[0].result)).toEqual({ price: 100 });
  });
  it("keeps the complete voice service identical outside precisely approved quote registration, prompt and fallback guards", () => {
    let candidate = read("server/vapiService.ts");
    candidate = candidate.replace('import { buildCallBookingQuoteToolDefinitions, callBookingQuoteServerToken, withCallBookingQuoteInstructions } from "./instinct/callBookingQuote";\n\n', "");
    candidate = candidate.replace('    ...buildCallBookingQuoteToolDefinitions(webhookUrl, callBookingQuoteServerToken(ENV.vapiPrivateKey)),\n', "");
    candidate = candidate.replace('content: withCallBookingQuoteInstructions(buildSystemPrompt()),', 'content: buildSystemPrompt(),');
    candidate = candidate.replace('  // Only this call\'s canonical quote-link receipt bypasses the old quote fallback.\n  const { hasCallBookingQuoteAttempt } = await import("./instinct/callBookingQuoteStore");\n  const quoteLinkHandled = await hasCallBookingQuoteAttempt(db, vapiCallId);\n\n', "");
    candidate = candidate.replace('if (!quoteLinkHandled && !leadCreated && normalizedPhone && structuredData)', 'if (!leadCreated && normalizedPhone && structuredData)');
    candidate = candidate.replace('if (!quoteLinkHandled && normalizedPhone && callSummaryForSms', 'if (normalizedPhone && callSummaryForSms');
    expect(candidate).toBe(baseline("server/vapiService.ts"));
  });
  it("keeps every customer-facing source, pricing policy, schema, payment and messaging source unchanged", () => {
    const diff = execFileSync("git", ["diff", "--name-only", "f168a07c986a992020dac74e8c52fce4c268b689", "--", "client", "shared", "drizzle", "server/openphone.ts", "server/webhooks.ts", "server/routers.ts", "server/_core/index.ts", "server/versioned-migrations"], { cwd: root, encoding: "utf8" });
    expect(diff.trim()).toBe("");
  });
  it("keeps the entire existing webhook unchanged outside quote imports and two new branches", () => {
    let candidate = read("server/vapiWebhook.ts");
    candidate = candidate.replace('import { ENV } from "./_core/env";\nimport { verifyCallBookingQuoteServerToken } from "./instinct/callBookingQuote";\n', "");
    candidate = candidate.replace(/            case "getBookingQuote":[\s\S]*?(?=            case "getQuote":)/, "");
    expect(candidate).toBe(baseline("server/vapiWebhook.ts"));
  });
});
