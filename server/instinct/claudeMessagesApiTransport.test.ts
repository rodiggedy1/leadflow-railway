// Direct Messages API connection for runInitialLeadDraft. Offline: the official SDK runs for real, with
// the network replaced by a fake fetch. No real key, model call, SMS or database access.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANTHROPIC_VERSION, CLAUDE_TRANSPORT, EXISTING_AGENT_ID, EXISTING_AGENT_VERSION, EXISTING_ENVIRONMENT_ID,
  MESSAGES_API_EFFORT, MESSAGES_API_MAX_TOKENS, ManagedAgentDemoError, SESSION_MODEL_ID,
  runInitialLeadDraft, runInitialLeadDraftOn,
} from "./claudeAgentClient";

const FAKE_KEY = "mocked-transport-key-not-a-credential";
const SYSTEM = "FIXED SHARED INSTRUCTIONS AND KNOWLEDGE BASE (synthetic)";
const USER = JSON.stringify({ incomingMessage: "Synthetic customer: can you come Friday?", context: { name: "Synthetic Customer" } });
const REPLY = '{"replyText":"Synthetic reply only"}';
type Obj = Record<string, any>;

function message(patch: Obj = {}): Obj {
  return { id: "msg_SyntheticOnly01", type: "message", role: "assistant", model: "claude-sonnet-5-5",
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: REPLY }],
    stop_reason: "end_turn", stop_sequence: null, stop_details: null,
    usage: { input_tokens: 812, output_tokens: 95, cache_read_input_tokens: 13600, cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } }, ...patch };
}
function fakeNetwork(responses: Array<{ status: number; body: Obj } | Error>) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: Obj }> = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method), headers: new Headers(init?.headers as HeadersInit),
      body: init?.body === undefined ? {} : JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error("UNEXPECTED_EXTRA_REQUEST");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json", "request-id": "req_synthetic" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try { await promise; return "RESOLVED"; } catch (error) {
    expect(error).toBeInstanceOf(ManagedAgentDemoError);
    return (error as ManagedAgentDemoError).code;
  }
}

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("direct connection: same request content as the saved-agent session", () => {
  it("is the active connection; rollback to the saved-agent session is one constant", () => {
    expect(CLAUDE_TRANSPORT).toBe("messages_api");
    expect(SESSION_MODEL_ID).toBe("claude-sonnet-5-5");
    expect(MESSAGES_API_EFFORT).toBe("low");
  });

  it("sends the same model and low effort, the fixed instructions as the only cached block, the customer part only as the message, no tools", async () => {
    const net = fakeNetwork([{ status: 200, body: message() }]);
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://redirect.example.invalid"); // ignored: the address is fixed
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "other-credential-not-used");
    await runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER, cacheTtl: "1h" });
    expect(net.calls).toHaveLength(1);
    const [call] = net.calls;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.method).toBe("POST");
    expect(call.headers.get("anthropic-version")).toBe(ANTHROPIC_VERSION);
    expect(call.headers.get("anthropic-beta")).toBeNull();
    expect(JSON.stringify([...call.headers])).toContain(FAKE_KEY);
    expect(JSON.stringify([...call.headers])).not.toContain("other-credential-not-used");
    expect(call.body).toEqual({
      model: "claude-sonnet-5-5", max_tokens: MESSAGES_API_MAX_TOKENS, output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: USER }],
    });
    // Customer-specific text never enters the cached prefix.
    expect(JSON.stringify(call.body.system)).not.toContain("Synthetic customer");
    for (const absent of ["tools", "tool_choice", "thinking", "temperature", "top_p", "top_k", "fallbacks", "stream", "cache_control"])
      expect(call.body, absent).not.toHaveProperty(absent);
  });

  it("uses the 5-minute cache unless the caller asks for 1 hour", async () => {
    const net = fakeNetwork([{ status: 200, body: message() }]);
    await runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER });
    expect(net.calls[0].body.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });

  it("returns the reply text in the same result shape, ignoring thinking blocks", async () => {
    fakeNetwork([{ status: 200, body: message() }]);
    expect(await runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER })).toEqual({
      sessionId: "msg_SyntheticOnly01", agentId: EXISTING_AGENT_ID, agentVersion: EXISTING_AGENT_VERSION,
      environmentId: EXISTING_ENVIRONMENT_ID, agentMessages: [{ providerEventId: "msg_SyntheticOnly01", text: REPLY }],
      finalSmsText: REPLY, toolCalls: [],
    });
  });

  it("logs cache creation (1 hour and 5 minutes), cache reads and output counts, never any text", async () => {
    fakeNetwork([{ status: 200, body: message({ usage: { input_tokens: 700, output_tokens: 80, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 13600, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 13600 } } }) }]);
    await runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER, cacheTtl: "1h" });
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line.startsWith("[claude-usage] ")).toBe(true);
    expect(JSON.parse(line.slice("[claude-usage] ".length))).toMatchObject({ transport: "messages_api", messageId: "msg_SyntheticOnly01",
      model: "claude-sonnet-5-5", cacheTtl: "1h", inputTokens: 700, cacheCreation5mTokens: 0, cacheCreation1hTokens: 13600,
      cacheReadTokens: 0, outputTokens: 80, stopReason: "end_turn" });
    for (const text of [SYSTEM, "Synthetic customer", "Synthetic reply", FAKE_KEY]) expect(line).not.toContain(text);
  });
});

describe("direct connection: failures become the existing errors, with no hidden retries", () => {
  it.each([
    ["refusal", message({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }), "INCOMPLETE_TURN"],
    ["cut-off reply", message({ stop_reason: "max_tokens" }), "INCOMPLETE_TURN"],
    ["empty reply", message({ content: [{ type: "text", text: "  " }] }), "INCOMPLETE_TURN"],
    ["unexpected tool call", message({ content: [{ type: "tool_use", id: "toolu_x", name: "x", input: {} }], stop_reason: "tool_use" }), "INVALID_RESPONSE"],
  ])("%s -> %s", async (_name, body, code) => {
    const net = fakeNetwork([{ status: 200, body }]);
    expect(await codeOf(runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER }))).toBe(code);
    expect(net.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([[500, "UNKNOWN_POST_OUTCOME"], [529, "UNKNOWN_POST_OUTCOME"], [408, "UNKNOWN_POST_OUTCOME"], [429, "PROVIDER_HTTP_ERROR"], [400, "PROVIDER_HTTP_ERROR"], [401, "PROVIDER_HTTP_ERROR"]])(
    "HTTP %i -> %s after exactly one request (SDK retries off)", async (status, code) => {
      const net = fakeNetwork([{ status, body: { type: "error", error: { type: "api_error", message: "synthetic provider detail" } } }]);
      const error = await runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER }).catch(e => e);
      expect(error).toBeInstanceOf(ManagedAgentDemoError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.message).not.toContain("synthetic provider detail");
      expect(net.fetchMock).toHaveBeenCalledTimes(1);
    });

  it("a network failure is an unknown outcome after one attempt", async () => {
    const net = fakeNetwork([new TypeError("synthetic network failure")]);
    expect(await codeOf(runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER }))).toBe("UNKNOWN_POST_OUTCOME");
    expect(net.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancellation stops the request", async () => {
    const controller = new AbortController();
    fakeNetwork([]);
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))));
    const pending = runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER, signal: controller.signal });
    controller.abort();
    expect(await codeOf(pending)).toBe("CANCELLED");
  });

  it("refuses before any request without a key, with an empty customer part, or when already cancelled", async () => {
    const net = fakeNetwork([]);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await codeOf(runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER }))).toBe("MISSING_API_KEY");
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY);
    expect(await codeOf(runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: "" }))).toBe("INVALID_PAYLOAD");
    const controller = new AbortController(); controller.abort();
    expect(await codeOf(runInitialLeadDraft({ systemPrompt: SYSTEM, userPrompt: USER, signal: controller.signal }))).toBe("CANCELLED");
    expect(() => runInitialLeadDraft({ systemPrompt: undefined as unknown as string, userPrompt: USER })).toThrow("INVALID_PAYLOAD");
    expect(net.fetchMock).not.toHaveBeenCalled();
  });
});

describe("rollback connection and callers", () => {
  it("the saved-agent session path is still available unchanged (it starts by reading the saved agent)", async () => {
    const net = fakeNetwork([{ status: 404, body: {} }]);
    expect(await codeOf(runInitialLeadDraftOn("managed_agents", { systemPrompt: SYSTEM, userPrompt: USER }))).toBe("PROVIDER_HTTP_ERROR");
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]).toMatchObject({ url: `https://api.anthropic.com/v1/agents/${EXISTING_AGENT_ID}`, method: "GET" });
    expect(net.calls[0].headers.get("anthropic-beta")).toBe("managed-agents-2026-04-01");
  });

  it("only automatic SMS replies ask for the 1-hour cache; every other caller keeps the default", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("./claudeCustomerSmsApplication.ts")).toContain('runner: options => runInitialLeadDraft({ ...options, cacheTtl: "1h", signal }),');
    for (const path of ["./claudeCustomerSmsGeneration.ts", "./smsBookingQuoteGeneration.ts", "./claudeCustomerCalls.ts",
      "./claudeStaffCalls.ts", "./claudeInitialLead.ts", "../teamLeaderboardComplaintDetect.ts", "./claudeCustomerEmailApplication.ts"])
      expect(read(path), path).not.toContain("cacheTtl");
  });

  it("the alternative-SMS button and the weekly review stay on the saved-agent session", () => {
    const source = readFileSync(new URL("./claudeAgentClient.ts", import.meta.url), "utf8");
    const general = source.slice(source.indexOf("export function runGeneralSmsDraft"), source.indexOf("export interface InitialLeadDraftOptions"));
    const weekly = source.slice(source.indexOf("export function runWeeklyCommunicationReview"));
    for (const body of [general, weekly]) {
      expect(body).toContain("return runManagedAgentSession(");
      expect(body).not.toContain("runMessagesApiDraft");
    }
  });
});
