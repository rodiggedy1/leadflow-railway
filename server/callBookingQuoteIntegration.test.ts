import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { callBookingQuoteServerToken, callBookingQuoteSendInputSchema, previewCallBookingQuote } from "./instinct/callBookingQuote";
const mock = vi.hoisted(() => ({ execute: vi.fn(async (_request: any): Promise<any> => ({ success: true })), getQuote: vi.fn(() => ({ price: 100 })), notify: vi.fn(), getDb: vi.fn(async () => null) }));
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
const retainedQuote = {
  pricing: { extras: [], bedrooms: 1, homeType: "Apartment", bathrooms: 1, condition: 5, hourCount: 1, maidCount: 1, serviceId: "standard", recurrence: "one-time", pricingMode: "home" },
  extrasConfirmed: true,
};
function quoteArgs(name: string) {
  return name === "getBookingQuote" ? structuredClone(retainedQuote) : {
    ...structuredClone(retainedQuote), customerName: "Synthetic Test Customer", customerPhone: "+13015550123",
    address: "123 Synthetic Test Street, Washington, DC", requestedLocalDate: "2099-12-15", requestedLocalTime: "14:30", smsNumberConfirmed: true,
  };
}
const envelopes = ["openai-object", "openai-json", "native-object"] as const;
function quoteTool(name: string, args: unknown, envelope: typeof envelopes[number], id = "retained-quote-tool") {
  return envelope === "native-object" ? { id, name, parameters: args } : {
    id, function: { name, arguments: envelope === "openai-json" ? JSON.stringify(args) : args },
  };
}
const routeCases = ["getBookingQuote", "textBookingQuote"].flatMap(name => envelopes.flatMap(envelope =>
  (["toolCallList", "toolCalls"] as const).map(listName => ({ name, envelope, listName }))));
async function call(tool: any, token?: string, listName: "toolCallList" | "toolCalls" = "toolCallList") {
  let handler: any;
  registerVapiWebhookRoute({ post: (_path: string, fn: any) => { handler = fn; } } as any);
  let response: any;
  const res: any = { status: () => res, json: (value: any) => { response = value; return value; } };
  await handler({ headers: token === undefined ? {} : { "x-instinct-call-quote-token": token }, body: { message: { type: "tool-calls", call: { id: "synthetic-inbound-call", customer: { number: "+13015550123" } }, [listName]: [tool] } } }, res);
  return response;
}

describe("call-only canonical quote integration — offline", () => {
  it.each([undefined, "", "incorrect"])("rejects new quote execution without correct dedicated authentication (%s)", async token => {
    mock.execute.mockClear();
    for (const name of ["getBookingQuote", "textBookingQuote"]) {
      const result = await call(quoteTool(name, quoteArgs(name), "openai-object"), token);
      expect(JSON.parse(result.results[0].result).code).toBe("UNAUTHORIZED_CALL_QUOTE");
    }
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it.each(["getBookingQuote", "textBookingQuote"])("dispatches only authenticated %s with exact call/tool identity", async name => {
    mock.execute.mockClear();
    const args = quoteArgs(name);
    const result = await call({ id: "tool-2", name, parameters: args }, callBookingQuoteServerToken("offline-vapi-key"));
    expect(mock.execute).toHaveBeenCalledWith({ callId: "synthetic-inbound-call", toolCallId: "tool-2", name, args });
    expect(JSON.parse(result.results[0].result).success).toBe(true);
  });
  it("preserves OpenAI-style argument parsing for the new tool", async () => {
    mock.execute.mockClear();
    await call(quoteTool("getBookingQuote", retainedQuote, "openai-json"), callBookingQuoteServerToken("offline-vapi-key"));
    expect(mock.execute.mock.calls[0][0].args).toEqual(retainedQuote);
  });
  it.each(routeCases)("retains exact $name fields through $envelope in $listName", async ({ name, envelope, listName }) => {
    mock.execute.mockClear();
    const args = quoteArgs(name);
    if (name === "textBookingQuote") expect(callBookingQuoteSendInputSchema.safeParse(args).success).toBe(true);
    const tool = quoteTool(name, args, envelope);
    const result = await call(tool, callBookingQuoteServerToken("offline-vapi-key"), listName);
    expect(mock.execute).toHaveBeenCalledTimes(1);
    expect(mock.execute).toHaveBeenCalledWith({ callId: "synthetic-inbound-call", toolCallId: tool.id, name, args });
    const captured = mock.execute.mock.calls[0][0].args;
    expect(captured.pricing).toEqual(retainedQuote.pricing);
    expect(captured.extrasConfirmed).toBe(true);
    if (envelope !== "openai-json") expect(captured).toBe(args);
    expect(result.results[0].toolCallId).toBe(tool.id);
    expect(JSON.parse(result.results[0].result).success).toBe(true);
  });
  it.each(routeCases.filter(({ name }) => name === "getBookingQuote"))("returns actual 189-dollar no-extras preview through $envelope in $listName", async ({ name, envelope, listName }) => {
    mock.execute.mockClear();
    mock.execute.mockImplementationOnce(async ({ args }: any) => previewCallBookingQuote(args));
    const tool = quoteTool(name, retainedQuote, envelope);
    const result = await call(tool, callBookingQuoteServerToken("offline-vapi-key"), listName);
    expect(mock.execute).toHaveBeenCalledTimes(1);
    expect(mock.execute).toHaveBeenCalledWith({ callId: "synthetic-inbound-call", toolCallId: tool.id, name, args: retainedQuote });
    expect(JSON.parse(result.results[0].result)).toMatchObject({ success: true, firstCleaningTotalCents: 18900, priceFormatted: "$189", extras: [], extrasConfirmed: true, bookingConfirmed: false, reservationConfirmed: false });
  });
  const invalidCases = ["getBookingQuote", "textBookingQuote"].flatMap(name => envelopes.flatMap(envelope =>
    ["malformed", "null", "array", "wrong-confirmation", "unknown-extra-field"].map(kind => ({ name, envelope, kind }))));
  it.each(invalidCases)("strict backend rejects $kind for $name through $envelope without sending", async ({ name, envelope, kind }) => {
    mock.execute.mockClear();
    const valid = quoteArgs(name);
    const raw = kind === "malformed" ? "{broken-json" : kind === "null" ? null : kind === "array" ? [] : kind === "wrong-confirmation" ? { ...valid, extrasConfirmed: "true" } : {
      ...valid, pricing: { ...valid.pricing, extras: [{ id: "inside-fridge", quantity: 1, unknownField: "must-not-be-stripped" }] },
    };
    const tool = quoteTool(name, raw, envelope);
    // A malformed OpenAI JSON envelope must stay malformed, not become a JSON string literal.
    if (kind === "malformed" && envelope === "openai-json") (tool as any).function.arguments = raw;
    mock.execute.mockImplementationOnce(async ({ args }: any) => name === "getBookingQuote" ? previewCallBookingQuote(args) : {
      success: callBookingQuoteSendInputSchema.safeParse(args).success, code: "INVALID_QUOTE",
    });
    const result = await call(tool, callBookingQuoteServerToken("offline-vapi-key"));
    expect(mock.execute).toHaveBeenCalledTimes(1);
    expect(mock.execute).toHaveBeenCalledWith({ callId: "synthetic-inbound-call", toolCallId: tool.id, name, args: raw });
    expect(JSON.parse(result.results[0].result)).toMatchObject({ success: false, code: "INVALID_QUOTE" });
  });
  it.each(["openai-object", "openai-json"] as const)("keeps legacy getQuote $envelope parsing unchanged", async envelope => {
    mock.getQuote.mockClear();
    const args = { bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", serviceType: "Standard Cleaning" };
    const result = await call(quoteTool("getQuote", args, envelope));
    expect(mock.getQuote).toHaveBeenCalledTimes(1);
    expect(mock.getQuote).toHaveBeenCalledWith(envelope === "openai-object" ? {} : args);
    expect(JSON.parse(result.results[0].result)).toEqual({ price: 100 });
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
    candidate = candidate.replace('import { ENV } from "./_core/env";\nimport { parseCallBookingQuoteToolArguments, verifyCallBookingQuoteServerToken } from "./instinct/callBookingQuote";\n', "");
    candidate = candidate.replace(/            case "getBookingQuote":[\s\S]*?(?=            case "getQuote":)/, "");
    expect(candidate).toBe(baseline("server/vapiWebhook.ts"));
  });
});
