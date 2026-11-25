// Focused extraction regressions reused from anthropicRescheduleDemo/client.test.ts.
// Existing SMS/input/result values are opaque mocked wire fixtures, not business effects.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ANTHROPIC_BETA, ANTHROPIC_VERSION, EXISTING_AGENT_ID,
  EXISTING_AGENT_VERSION, EXISTING_ENVIRONMENT_ID, ManagedAgentDemoError, SESSION_MODEL_ID,
  runGeneralSmsDraft, type Backend, type ObservedEvent, type GeneralSmsDraftOptions,
  runInitialLeadDraft, type InitialLeadDraftOptions, type TraceEntry,
} from "./claudeAgentClient";

type Obj = Record<string, any>;
const SESSION_ID = "sesn_MockedSyntheticOnly01";
const FAKE_KEY = "mocked-transport-key-not-a-credential";
const SMS = "SIMULATED SMS ONLY: synthetic-customer requests next Thursday. No real SMS.";
const NOW = "2026-11-15T22:00:00Z";
const INITIAL_SYSTEM = "  Exact caller system\r\nPrivate first-lead instructions — café.\n\t";
const INITIAL_USER = "\tExact caller user prompt\r\nSynthetic lead context only.\n  ";
const toolDefinition = {
  name: "get_customer_context", description: "Read-only mocked context for the existing transport fixture.",
  input_schema: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"], additionalProperties: false },
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function baseAgent(): Obj {
  return { type: "agent", id: EXISTING_AGENT_ID, version: EXISTING_AGENT_VERSION,
    archived_at: null, model: { id: "inherited-model-fixture-not-a-model-selection", effort: "fixture-effort" },
    system: "mocked private agent system: must never appear in traces", name: "synthetic-agent-fixture",
    multiagent: null, tools: [{ type: "agent_toolset_20260401" }],
    mcp_servers: [{ type: "url", name: "never-invoked-fixture", url: "https://example.invalid" }], skills: [] };
}
function environment(): Obj {
  return { type: "environment", id: EXISTING_ENVIRONMENT_ID, archived_at: null,
    config: { type: "cloud", networking: { type: "unrestricted" }, packages: {} },
    metadata: { private_fixture: "must never appear in traces" } };
}
function sessionFor(base: Obj): Obj {
  return { type: "session", id: SESSION_ID, agent: { ...clone(base), ...(base.model === undefined ? {} : { model: { ...clone(base.model), id: SESSION_MODEL_ID } }),
    tools: [{ type: "custom", ...clone(toolDefinition) }], mcp_servers: [], skills: [] },
    environment_id: EXISTING_ENVIRONMENT_ID, status: "idle", archived_at: null,
    resources: [], vault_ids: [], budget: null, deployment_id: null };
}
function event(type: string, id: string, fields: Obj = {}): Obj {
  return { type, id, processed_at: NOW, ...fields };
}
const tool = (id = "sevt_tool1", input: Obj = { bookingId: "synthetic-booking" }, name = toolDefinition.name) =>
  event("agent.custom_tool_use", id, { name, input });
const message = (text = "Your synthetic booking was moved to Thursday.", id = "sevt_sms1") =>
  event("agent.message", id, { content: [{ type: "text", text }] });
const idle = (type = "end_turn", eventIds?: string[], id = "sevt_idle1") =>
  event("session.status_idle", id, { stop_reason: { type, ...(eventIds ? { event_ids: eventIds } : {}) }, stop_details: null });
function frame(value: Obj, multiline = false, separator = "\n"): string {
  const encoded = JSON.stringify(value, null, multiline ? 2 : undefined);
  return `event: ${value.type}${separator}${encoded.split("\n").map(line => `data: ${line}`).join(separator)}${separator}${separator}`;
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
interface HttpCall { method: string; path: string; body?: Obj }
interface HarnessOptions {
  initialLead?: { systemPrompt: string; userPrompt: string };
  mutateBase?: (base: Obj) => void;
  mutateEnvironment?: (env: Obj) => void;
  mutateSession?: (session: Obj) => void;
  onMessage?: (h: Harness) => void;
  onToolResult?: (h: Harness, sent: Obj) => Response | Promise<Response> | void;
  overrideHttp?: (call: HttpCall, h: Harness) => Response | Promise<Response> | undefined;
  backendCall?: Backend["callTool"];
}
interface Harness {
  calls: HttpCall[];
  backend: Backend;
  toolCalls: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
  events: ObservedEvent[];
  traces: TraceEntry[];
  push: (value: Obj, multiline?: boolean, separator?: string, byteSplit?: boolean) => void;
  raw: (text: string, byteSplit?: boolean) => void;
  close: () => void;
  run: (extra?: Partial<GeneralSmsDraftOptions>) => ReturnType<typeof runGeneralSmsDraft>;
  runInitial: (extra?: Partial<InitialLeadDraftOptions>) => ReturnType<typeof runInitialLeadDraft>;
}
function harness(config: HarnessOptions = {}): Harness {
  const base = baseAgent(); config.mutateBase?.(base);
  const env = environment(); config.mutateEnvironment?.(env);
  const session = sessionFor(base);
  if (config.initialLead) {
    session.agent.system = config.initialLead.systemPrompt;
    session.agent.tools = [];
  }
  config.mutateSession?.(session);
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let streamOpened = false;
  let userSent = false;
  let echoCounter = 0;
  const calls: HttpCall[] = [], events: ObservedEvent[] = [], traces: TraceEntry[] = [];
  const toolCalls = vi.fn(config.backendCall ?? (async () => ({ status: "applied", synthetic: true, newDate: "2026-11-19" })));
  const backend: Backend = { tools: [clone(toolDefinition)], callTool: toolCalls };
  const h = {
    calls, backend, toolCalls, events, traces,
    raw(text: string, byteSplit = false) {
      const bytes = new TextEncoder().encode(text);
      if (byteSplit) for (const byte of bytes) stream!.enqueue(new Uint8Array([byte]));
      else stream!.enqueue(bytes);
    },
    push(value: Obj, multiline = false, separator = "\n", byteSplit = false) {
      h.raw(frame(value, multiline, separator), byteSplit);
    },
    close() { stream!.close(); },
    async run(extra: Partial<GeneralSmsDraftOptions> = {}) {
      return runGeneralSmsDraft({ reviewOnly: true, backend, reviewPayload: SMS,
        onEvent: received => { events.push(received); },
        onTrace: entry => { traces.push(entry); }, ...extra });
    },
    async runInitial(extra: Partial<InitialLeadDraftOptions> = {}) {
      return runInitialLeadDraft({ systemPrompt: INITIAL_SYSTEM, userPrompt: INITIAL_USER,
        ...config.initialLead,
        onEvent: received => { events.push(received); },
        onTrace: entry => { traces.push(entry); }, ...extra });
    },
  } as Harness;
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe("https://api.anthropic.com");
    expect(parsed.search).toBe("");
    const method = init?.method ?? "GET", path = parsed.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe(FAKE_KEY);
    expect(headers.get("anthropic-version")).toBe(ANTHROPIC_VERSION);
    expect(headers.get("anthropic-beta")).toBe(ANTHROPIC_BETA);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const call = { method, path, ...(body ? { body } : {}) };
    calls.push(call);
    const overridden = config.overrideHttp?.(call, h);
    if (overridden !== undefined) return await overridden;
    if (method === "GET" && path === `/v1/agents/${EXISTING_AGENT_ID}`) return json(base);
    if (method === "GET" && path === `/v1/environments/${EXISTING_ENVIRONMENT_ID}`) return json(env);
    if (method === "POST" && path === "/v1/sessions") return json(session);
    if (method === "GET" && path === `/v1/sessions/${SESSION_ID}/events/stream`) {
      streamOpened = true;
      expect(headers.get("accept")).toBe("text/event-stream");
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } });
    }
    if (method === "POST" && path === `/v1/sessions/${SESSION_ID}/events`) {
      expect(streamOpened).toBe(true);
      expect(body.events).toHaveLength(1);
      const sent = body.events[0];
      const echo = { ...sent, id: `sevt_echo${++echoCounter}`, processed_at: NOW };
      if (sent.type === "user.message") {
        expect(userSent).toBe(false); userSent = true;
        expect(sent).toEqual({ type: "user.message", content: [{ type: "text", text: config.initialLead?.userPrompt ?? SMS }] });
        config.onMessage?.(h);
      } else if (sent.type === "user.custom_tool_result") {
        expect(userSent).toBe(true);
        const reply = config.onToolResult?.(h, sent);
        if (reply !== undefined) return await reply;
      } else throw new Error("Mock transport refused unrequested mutation");
      return json({ data: [echo] });
    }
    throw new Error("Mock transport refused unexpected endpoint");
  });
  h.fetchMock = fetchMock;
  vi.stubGlobal("fetch", fetchMock);
  return h;
}
async function stopped(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "ManagedAgentDemoError", code });
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", FAKE_KEY); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("MOCKED TRANSPORT ONLY: exact first-lead instructions without tools", () => {
  const initialHarness = (config: HarnessOptions = {}) => harness({
    initialLead: { systemPrompt: INITIAL_SYSTEM, userPrompt: INITIAL_USER }, ...config,
  });

  it("replaces only the session system, sends the exact user string, preserves saved model and returns raw SMS", async () => {
    const rawSms = "  Raw SMS — café\n\tNo transport trimming.  ";
    const h = initialHarness({ onMessage: h => {
      expect(h.traces.some(entry => entry.stage === "session_verified")).toBe(true);
      h.push(event("user.message", "sevt_echo1", { content: [{ type: "text", text: INITIAL_USER }] }));
      h.push(message(rawSms), true, "\r\n", true);
      h.push(idle());
    } });
    const result = await h.runInitial();
    expect(result).toEqual({ sessionId: SESSION_ID, agentId: EXISTING_AGENT_ID,
      agentVersion: EXISTING_AGENT_VERSION, environmentId: EXISTING_ENVIRONMENT_ID,
      agentMessages: [{ providerEventId: "sevt_sms1", text: rawSms }], finalSmsText: rawSms, toolCalls: [] });
    expect(h.calls.find(call => call.path === "/v1/sessions")!.body).toEqual({
      agent: { type: "agent_with_overrides", id: EXISTING_AGENT_ID, version: EXISTING_AGENT_VERSION,
        model: { ...baseAgent().model, id: SESSION_MODEL_ID }, system: INITIAL_SYSTEM, tools: [], mcp_servers: [], skills: [] },
      environment_id: EXISTING_ENVIRONMENT_ID,
    });
    expect(h.calls.at(-1)?.body).toEqual({ events: [{ type: "user.message",
      content: [{ type: "text", text: INITIAL_USER }] }] });
    // Exact endpoint allowlist also excludes saved-agent creation/mutation and all business calls.
    expect(h.calls.map(call => `${call.method} ${call.path}`)).toEqual([
      `GET /v1/agents/${EXISTING_AGENT_ID}`, `GET /v1/environments/${EXISTING_ENVIRONMENT_ID}`,
      "POST /v1/sessions", `GET /v1/sessions/${SESSION_ID}/events/stream`,
      `POST /v1/sessions/${SESSION_ID}/events`,
    ]);
    expect(h.toolCalls).not.toHaveBeenCalled();
    expect(JSON.stringify({ events: h.events, traces: h.traces })).not.toContain(INITIAL_SYSTEM);
    expect(h.traces.at(-1)?.stage).toBe("completed");
  });

  it.each(["", "\n  \t", "exact replacement"])("uses the exact system string %j even when saved system is null", async systemPrompt => {
    const h = initialHarness({ initialLead: { systemPrompt, userPrompt: INITIAL_USER },
      mutateBase: base => { base.system = null; },
      onMessage: h => { h.push(message()); h.push(idle()); } });
    await h.runInitial();
    expect(h.calls.find(call => call.path === "/v1/sessions")!.body!.agent.system).toBe(systemPrompt);
  });

  it("runs every session on Sonnet 5.5 with the saved agent's other model settings, without changing the saved agent", async () => {
    expect(SESSION_MODEL_ID).toBe("claude-sonnet-5-5");
    const h = initialHarness({ onMessage: h => { h.push(message()); h.push(idle()); } });
    await h.runInitial();
    const sent = h.calls.find(call => call.path === "/v1/sessions")!.body!.agent.model;
    expect(sent).toEqual({ id: "claude-sonnet-5-5", effort: baseAgent().model.effort });
    expect(h.calls.filter(call => call.method !== "GET" && call.path.startsWith("/v1/agents"))).toHaveLength(0);
  });

  it("accepts extra default fields in the resolved model but still requires the sent ones", async () => {
    const h = initialHarness({ mutateSession: s => { s.agent.model.speed = "standard"; },
      onMessage: h => { h.push(message()); h.push(idle()); } });
    expect((await h.runInitial()).finalSmsText).toBeTruthy();
  });

  it("does not parse or wrap the returned agent text", async () => {
    const rawText = '{"opaque":"agent text, not a transport output schema"}';
    const h = initialHarness({ onMessage: h => { h.push(message(rawText)); h.push(idle()); } });
    expect((await h.runInitial()).finalSmsText).toBe(rawText);
  });

  it.each([
    ["inherited saved system", (s: Obj) => { s.agent.system = baseAgent().system; }],
    ["appended saved system", (s: Obj) => { s.agent.system = baseAgent().system + INITIAL_SYSTEM; }],
    ["trimmed caller system", (s: Obj) => { s.agent.system = INITIAL_SYSTEM.trim(); }],
    ["missing system", (s: Obj) => { delete s.agent.system; }],
    ["null system", (s: Obj) => { s.agent.system = null; }],
    ["context tool", (s: Obj) => { s.agent.tools = [{ type: "custom", ...toolDefinition }]; }],
    ["builtin tool", (s: Obj) => { s.agent.tools = [{ type: "agent_toolset_20260401" }]; }],
    ["missing tool list", (s: Obj) => { delete s.agent.tools; }],
    ["MCP server", (s: Obj) => { s.agent.mcp_servers = [{ name: "unsafe" }]; }],
    ["skill", (s: Obj) => { s.agent.skills = [{ skill_id: "unsafe" }]; }],
    ["changed saved model ID", (s: Obj) => { s.agent.model.id = "changed-model-fixture"; }],
    ["changed saved model configuration", (s: Obj) => { s.agent.model.effort = "changed"; }],
  ])("rejects resolved %s before stream or user-message send", async (_label, mutateSession) => {
    const h = initialHarness({ mutateSession: mutateSession as (s: Obj) => void });
    await stopped(h.runInitial(), "SESSION_MISMATCH");
    expect(h.calls).toHaveLength(3);
    expect(h.calls.some(call => call.path.includes("/events"))).toBe(false);
    expect(h.toolCalls).not.toHaveBeenCalled();
    expect(h.traces.some(entry => entry.stage === "session_verified")).toBe(false);
  });

  it.each(["agent.custom_tool_use", "agent.tool_use", "agent.mcp_tool_use", "agent.tool_result", "agent.mcp_tool_result"])("rejects unexpected %s without backend execution or tool result", async type => {
    const h = initialHarness({ onMessage: h => h.push(event(type, "sevt_forbidden", { name: toolDefinition.name, input: {} })) });
    await stopped(h.runInitial(), "UNSAFE_TOOL");
    expect(h.toolCalls).not.toHaveBeenCalled();
    expect(h.calls.filter(call => call.body?.events?.[0]?.type === "user.custom_tool_result")).toHaveLength(0);
  });

  it("rejects invalid prompts or cancellation before HTTP", async () => {
    const h = initialHarness();
    await stopped(h.runInitial({ userPrompt: "" }), "INVALID_PAYLOAD");
    await stopped(h.runInitial({ systemPrompt: null as unknown as string }), "INVALID_PAYLOAD");
    const controller = new AbortController(); controller.abort();
    await stopped(h.runInitial({ signal: controller.signal }), "CANCELLED");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["configuration_fetch", "configuration_json", "session_post", "sse"])("aborts an initial run during %s and removes the caller listener without retry", async waitingAt => {
    let rejectPending!: (error: Error) => void;
    const pending = () => new Promise<Response>((_resolve, reject) => { rejectPending = reject; });
    const h = initialHarness({ overrideHttp: call => {
      if (call.path.startsWith("/v1/agents/")) {
        if (waitingAt === "configuration_fetch") return pending();
        if (waitingAt === "configuration_json") {
          const response = json(baseAgent());
          vi.spyOn(response, "json").mockImplementation(pending);
          return response;
        }
      }
      if (waitingAt === "session_post" && call.method === "POST" && call.path === "/v1/sessions") return pending();
    } });
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener"), removed = vi.spyOn(controller.signal, "removeEventListener");
    const running = h.runInitial({ signal: controller.signal });
    await settle();
    const expectedCalls = waitingAt === "sse" ? 5 : waitingAt === "session_post" ? 3 : 1;
    expect(h.calls).toHaveLength(expectedCalls);
    const fetchSignal = h.fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(fetchSignal.aborted).toBe(false); controller.abort("private cancellation reason");
    await stopped(running, "CANCELLED"); expect(fetchSignal.aborted).toBe(true);
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
    if (waitingAt !== "sse") rejectPending(new Error("PRIVATE_LATE_REJECTION"));
    await settle(); expect(h.calls).toHaveLength(expectedCalls); expect(h.toolCalls).not.toHaveBeenCalled();
    expect(JSON.stringify(h.traces)).not.toContain("PRIVATE_");
  });

  it("observes a rejected hook promise when that hook synchronously aborts before race registration", async () => {
    const h = initialHarness(), controller = new AbortController();
    let rejectHook!: (error: Error) => void;
    const hook = new Promise<void>((_resolve, reject) => { rejectHook = reject; });
    const running = h.runInitial({ signal: controller.signal, onTrace: entry => {
      if (entry.stage === "http_response") { controller.abort(); return hook; }
    } });
    await stopped(running, "CANCELLED");
    rejectHook(new Error("PRIVATE_DETACHED_HOOK_REJECTION")); await settle();
    expect(h.calls).toHaveLength(1); expect(h.toolCalls).not.toHaveBeenCalled();
  });

  it("leaves the existing general-draft inherited-system and one-context-tool defaults intact", async () => {
    const h = harness({ onMessage: h => { h.push(message()); h.push(idle()); } });
    await h.run();
    const override = h.calls.find(call => call.path === "/v1/sessions")!.body!.agent;
    expect(override).not.toHaveProperty("system");
    expect(override.model).toEqual({ ...baseAgent().model, id: SESSION_MODEL_ID });
    expect(override.tools).toEqual([{ type: "custom", ...toolDefinition }]);
  });
});

describe("MOCKED TRANSPORT ONLY: extracted existing-agent general SMS draft", () => {
  it("runs a complete HTTP/SSE lifecycle; tool result arrives before requires_action; final SMS is buffered text", async () => {
    const h = harness({
      onMessage: h => {
        h.raw(": comment\r\nevent: ping\r\ndata: not-json\r\n\r\n", true);
        h.push(event("session.status_running", "sevt_running"), true, "\r\n", true);
        h.push(event("span.model_request_start", "sevt_modelstart"));
        h.push(event("agent.thinking", "sevt_thinking"));
        h.push(event("session.thread_status_running", "sevt_primary", { agent_name: "synthetic-agent-fixture", session_thread_id: "sthr_primary" }));
        h.push(event("span.model_request_end", "sevt_modelend", { is_error: false, model_request_start_id: "sevt_modelstart", model_usage: {} }));
        h.push(tool(), true, "\r\n", true);
        // No idle has been emitted. Waiting for idle would deadlock this test.
      },
      onToolResult: (h, sent) => {
        expect(sent.custom_tool_use_id).toBe("sevt_tool1");
        expect(JSON.parse(sent.content[0].text)).toEqual({ status: "applied", synthetic: true, newDate: "2026-11-19" });
        h.push(idle("requires_action", ["sevt_tool1"], "sevt_wait"));
        h.push(message("Interim synthetic confirmation.", "sevt_interim"));
        h.push(message("Your synthetic booking moved to Thursday — café confirmed."), true, "\r", true);
        h.push(event("session.usage", "sevt_usage", { usage: { fixture_tokens: 999999999 } }));
        h.push(idle());
      },
    });
    const result = await h.run();
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.finalSmsText).toBe("Your synthetic booking moved to Thursday — café confirmed.");
    expect(result.agentMessages).toHaveLength(2);
    expect(result.toolCalls).toEqual([{ providerEventId: "sevt_tool1", name: toolDefinition.name,
      resultJson: JSON.stringify({ status: "applied", synthetic: true, newDate: "2026-11-19" }),
      resultEventId: "sevt_echo2", delivery: "acknowledged", replayMetadataReused: false }]);
    expect(h.toolCalls).toHaveBeenCalledTimes(1);
    expect(h.toolCalls).toHaveBeenCalledWith(toolDefinition.name, { bookingId: "synthetic-booking" }, "sevt_tool1");
    const create = h.calls.find(call => call.path === "/v1/sessions")!;
    expect(create.body).toEqual({ agent: { type: "agent_with_overrides", id: EXISTING_AGENT_ID,
      version: 1, model: { ...baseAgent().model, id: SESSION_MODEL_ID }, tools: [{ type: "custom", ...toolDefinition }], mcp_servers: [], skills: [] }, environment_id: EXISTING_ENVIRONMENT_ID });
    expect(h.calls.map(call => `${call.method} ${call.path}`)).toEqual([
      `GET /v1/agents/${EXISTING_AGENT_ID}`, `GET /v1/environments/${EXISTING_ENVIRONMENT_ID}`,
      "POST /v1/sessions", `GET /v1/sessions/${SESSION_ID}/events/stream`,
      `POST /v1/sessions/${SESSION_ID}/events`, `POST /v1/sessions/${SESSION_ID}/events`,
    ]);
    expect(h.events.find(e => e.id === "sevt_tool1")).toEqual({ id: "sevt_tool1", type: "agent.custom_tool_use", name: toolDefinition.name, input: { bookingId: "synthetic-booking" } });
    const logs = JSON.stringify({ traces: h.traces, events: h.events });
    expect(logs).not.toContain(FAKE_KEY);
    expect(logs).not.toContain(baseAgent().system);
    expect(logs).not.toContain("private_fixture");
    expect(h.traces.at(-1)?.stage).toBe("completed");
  });

  it("suppresses exact tool replays; prior receipt metadata is reused once with no repeated execution/POST", async () => {
    const input = { bookingId: "fixture", detail: { a: 1, b: 2 } };
    const h = harness({ onMessage: h => h.push(tool("sevt_tool1", input)), onToolResult: h => {
      h.push(tool("sevt_tool1", { detail: { b: 2, a: 1 }, bookingId: "fixture" }));
      h.push(tool("sevt_tool1", input)); h.push(message()); h.push(message()); h.push(idle());
    } });
    const result = await h.run();
    expect(h.toolCalls).toHaveBeenCalledTimes(1);
    expect(h.calls.filter(c => c.body?.events?.[0]?.type === "user.custom_tool_result")).toHaveLength(1);
    expect(result.toolCalls[0].replayMetadataReused).toBe(true);
    expect(h.traces.filter(t => t.stage === "tool_replay_suppressed")).toHaveLength(1);
    expect(result.agentMessages).toHaveLength(1);
  });
  it("refuses same provider event ID with different input", async () => {
    const h = harness({ onMessage: h => h.push(tool()), onToolResult: h => h.push(tool("sevt_tool1", { bookingId: "DIFFERENT" })) });
    await stopped(h.run(), "REPLAY_CONFLICT"); expect(h.toolCalls).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong existing agent ID", (a: Obj) => { a.id = "agent_other"; }, "AGENT_MISMATCH"],
    ["wrong existing agent version", (a: Obj) => { a.version = 2; }, "AGENT_MISMATCH"],
    ["missing model", (a: Obj) => { delete a.model; }, "AGENT_MISMATCH"],
    ["missing system snapshot", (a: Obj) => { delete a.system; }, "AGENT_MISMATCH"],
  ])("refuses %s before creating a session", async (_label, mutate, code) => {
    const h = harness({ mutateBase: mutate as (a: Obj) => void });
    await stopped(h.run(), code as string);
    expect(h.calls).toHaveLength(1); expect(h.toolCalls).not.toHaveBeenCalled();
  });

  it.each([
    ["agent ID", (s: Obj) => { s.agent.id = "agent_wrong"; }],
    ["agent version", (s: Obj) => { s.agent.version = 7; }],
    ["model preservation", (s: Obj) => { s.agent.model.effort = "changed"; }],
    ["system preservation", (s: Obj) => { s.agent.system = "changed"; }],
    ["builtin tools", (s: Obj) => { s.agent.tools.push({ type: "agent_toolset_20260401" }); }],
    ["custom schema", (s: Obj) => { s.agent.tools[0].input_schema.required = []; }],
    ["extra custom tool", (s: Obj) => { s.agent.tools.push({ type: "custom", ...toolDefinition, name: "other" }); }],
    ["MCP server", (s: Obj) => { s.agent.mcp_servers = [{ name: "unsafe" }]; }],
    ["skills", (s: Obj) => { s.agent.skills = [{ skill_id: "unsafe" }]; }],
    ["attached vault", (s: Obj) => { s.vault_ids = ["vlt_mocked_unsafe"]; }],
  ])("refuses resolved session mismatch: %s before the user message", async (_label, mutate) => {
    const h = harness({ mutateSession: mutate as (s: Obj) => void });
    await stopped(h.run(), "SESSION_MISMATCH");
    expect(h.calls).toHaveLength(3); expect(h.toolCalls).not.toHaveBeenCalled();
    expect(h.traces.some(t => t.stage === "session_created")).toBe(true);
    expect(h.traces.some(t => t.stage === "session_verified")).toBe(false);
  });

  it("rejects a malicious session ID before using it in a path", async () => {
    const h = harness({ mutateSession: s => { s.id = "sesn_foo/../../agents"; } });
    await stopped(h.run(), "SESSION_MISMATCH"); expect(h.calls).toHaveLength(3);
  });

  it.each(["unknown_custom", "bash", "mcp__production"])("refuses provider tool name outside exact backend whitelist: %s", async name => {
    const h = harness({ onMessage: h => h.push(tool("sevt_tool1", {}, name)) });
    await stopped(h.run(), "UNSAFE_TOOL"); expect(h.toolCalls).not.toHaveBeenCalled();
  });
  it.each(["agent.tool_use", "agent.mcp_tool_use", "agent.tool_result", "agent.mcp_tool_result"])("fails closed on unexpected builtin/MCP event %s", async type => {
    const h = harness({ onMessage: h => h.push(event(type, "sevt_unsafe", { name: "bash", input: {} })) });
    await stopped(h.run(), "UNSAFE_TOOL"); expect(h.toolCalls).not.toHaveBeenCalled();
  });
  it("refuses a cross-posted subagent custom call", async () => {
    const h = harness({ onMessage: h => h.push({ ...tool(), session_thread_id: "sthr_other" }) });
    await stopped(h.run(), "UNSAFE_TOOL"); expect(h.toolCalls).not.toHaveBeenCalled();
  });

  it.each(["session.error", "session.status_terminated", "session.deleted", "session.status_rescheduled"])("fails closed and redacts event error body for %s", async type => {
    const h = harness({ onMessage: h => h.push(event(type, "sevt_failure", { error: { message: FAKE_KEY, config: baseAgent().system } })) });
    try { await h.run(); expect.fail("must fail"); } catch (error) {
      expect(error).toBeInstanceOf(ManagedAgentDemoError);
      expect(error).toMatchObject({ code: "PROVIDER_SESSION_ERROR" });
      expect(String(error)).not.toContain(FAKE_KEY);
    }
    expect(JSON.stringify({ events: h.events, traces: h.traces })).not.toContain(FAKE_KEY);
  });

  it("backend HTTP outcome unknown stops: no success result, repeat execution or final SMS", async () => {
    const h = harness({ onMessage: h => { h.push(tool()); h.push(tool()); h.push(message()); h.push(idle()); },
      backendCall: async () => { throw new Error(`HTTP timeout with private detail ${FAKE_KEY}`); } });
    await stopped(h.run(), "TOOL_OUTCOME_UNKNOWN");
    expect(h.toolCalls).toHaveBeenCalledTimes(1);
    expect(h.calls.filter(c => c.body?.events?.[0]?.type === "user.custom_tool_result")).toHaveLength(0);
    expect(h.traces.some(t => t.stage === "completed")).toBe(false);
    expect(JSON.stringify(h.traces)).not.toContain(FAKE_KEY);
  });

  it.each([500, 529, 408])("ambiguous tool-result POST HTTP %s stops without any retry", async status => {
    const h = harness({ onMessage: h => h.push(tool()), onToolResult: () => json({ error: { message: FAKE_KEY } }, status) });
    await stopped(h.run(), "UNKNOWN_POST_OUTCOME");
    expect(h.toolCalls).toHaveBeenCalledTimes(1);
    expect(h.calls.filter(c => c.body?.events?.[0]?.type === "user.custom_tool_result")).toHaveLength(1);
    expect(h.traces.some(t => t.stage === "tool_result_acknowledged")).toBe(false);
  });
  it("ambiguous tool-result network outcome stops without retry and without original exception retention", async () => {
    const h = harness({ onMessage: h => h.push(tool()), onToolResult: async () => { throw new Error(FAKE_KEY); } });
    try { await h.run(); expect.fail("must fail"); } catch (error) {
      expect(error).toMatchObject({ code: "UNKNOWN_POST_OUTCOME", outcome: "unknown" });
      expect((error as Error).cause).toBeUndefined(); expect(String(error)).not.toContain(FAKE_KEY);
    }
    expect(h.toolCalls).toHaveBeenCalledTimes(1); expect(h.calls).toHaveLength(6);
  });

  it.each([401, 403, 429])("redacts provider HTTP %s error and does not retry configuration reads", async status => {
    const h = harness({ overrideHttp: call => call.path.startsWith("/v1/agents/") ? json({ error: { message: FAKE_KEY, system: baseAgent().system } }, status) : undefined });
    try { await h.run(); expect.fail("must fail"); } catch (error) {
      expect(error).toMatchObject({ code: "PROVIDER_HTTP_ERROR", status }); expect(String(error)).not.toContain(FAKE_KEY);
    }
    expect(h.calls).toHaveLength(1);
  });
  it("never retries ambiguous new-session POST", async () => {
    const h = harness({ overrideHttp: call => call.method === "POST" && call.path === "/v1/sessions" ? Promise.reject(new Error(FAKE_KEY)) : undefined });
    await stopped(h.run(), "UNKNOWN_POST_OUTCOME"); expect(h.calls).toHaveLength(3);
  });

  it("already-cancelled signal performs no HTTP", async () => {
    const h = harness(), controller = new AbortController(); controller.abort("sensitive cancellation reason");
    await stopped(h.run({ signal: controller.signal }), "CANCELLED"); expect(h.calls).toHaveLength(0);
  });
  it("cancels while waiting on SSE without returning a successful turn", async () => {
    const h = harness(), controller = new AbortController();
    const running = h.run({ signal: controller.signal });
    await settle(); expect(h.calls).toHaveLength(5); controller.abort();
    await stopped(running, "CANCELLED"); expect(h.toolCalls).not.toHaveBeenCalled();
  });
  it("cancels pending backend execution; cannot undo mutation, but never posts a late/fake result", async () => {
    let resolveTool!: (value: unknown) => void;
    const h = harness({ onMessage: h => h.push(tool()), backendCall: () => new Promise(resolve => { resolveTool = resolve; }) });
    const controller = new AbortController(); const running = h.run({ signal: controller.signal });
    await settle(); expect(h.toolCalls).toHaveBeenCalledTimes(1); controller.abort();
    await stopped(running, "CANCELLED"); resolveTool({ status: "applied" }); await settle();
    expect(h.calls).toHaveLength(5);
  });
  it("cancels a pending provider request even when mocked fetch ignores its signal", async () => {
    const h = harness({ overrideHttp: () => new Promise<Response>(() => {}) });
    const controller = new AbortController(); const running = h.run({ signal: controller.signal });
    await settle(); controller.abort(); await stopped(running, "CANCELLED");
    expect(h.calls).toHaveLength(1);
  });

  it("import exposes only opt-in code; no package, application, proxy or data dependency", () => {
    const source = readFileSync(new URL("./claudeAgentClient.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/invokeLLM|listLLMModels|manus-proxy|createPool|createConnection|\.listen\(/);
    expect(source).not.toContain(["cleaner", "jobs"].join("_"));
    expect(source).not.toContain(["cleaner", "Jobs"].join(""));
    expect(source).toContain("globalThis.fetch"); expect(source).toContain("process.env.ANTHROPIC_API_KEY");
  });
  it("missing runtime key or payload fails before HTTP", async () => {
    const h = harness(); vi.stubEnv("ANTHROPIC_API_KEY", "");
    await stopped(h.run(), "MISSING_API_KEY"); await stopped(h.run({ reviewPayload: "" }), "INVALID_PAYLOAD");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

});

// Entry-point guards reused from reviewOnly.test.ts and claudeSmsDraft.test.ts.
function backend(name: string): Backend {
  return { tools: [{ name, description: "Review-only test tool", input_schema: { type: "object", properties: {}, additionalProperties: false } }], callTool: vi.fn(async () => ({ effectState: "not_applied" })) };
}
describe("general SMS draft read-only entry-point guards", () => {
  it.each(["reschedule_booking", "send_sms", "cancel_booking", "add_extras", "list_week_availability", "bash"])("rejects %s before provider/backend calls", name => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const port = backend(name);
    expect(() => runGeneralSmsDraft({ reviewOnly: true, backend: port, reviewPayload: "Stored customer message" })).toThrow(ManagedAgentDemoError);
    expect(fetch).not.toHaveBeenCalled();
    expect(port.callTool).not.toHaveBeenCalled();
  });
  it("requires the explicit review-only mode before any execution", () => {
    const port = backend("get_customer_context");
    expect(() => runGeneralSmsDraft({ reviewOnly: false as unknown as true, backend: port, reviewPayload: "Stored customer message" })).toThrow(ManagedAgentDemoError);
    expect(port.callTool).not.toHaveBeenCalled();
  });
  it("general transport rejects operational backend before reading credentials or networking", () => {
    for (const name of ["send_sms", "check_availability", "propose_reschedule", "write"]) expect(() => runGeneralSmsDraft({ reviewOnly: true, reviewPayload: "data",
      backend: { tools: [{ name, description: "forbidden", input_schema: { type: "object" } }], callTool: async () => ({}) } })).toThrow("INVALID_BACKEND");
  });
});

describe("scoped source extraction preservation", () => {
  it("keeps the protected baseline transport and exact general wrapper except explicit first-lead extensions", () => {
    const source = readFileSync(new URL("./claudeAgentClient.ts", import.meta.url), "utf8");
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const coreStart = source.indexOf("/** Creates only a NEW session;");
    const wrapperStart = source.indexOf("export interface GeneralSmsDraftOptions");
    const initialStart = source.indexOf("\nexport interface InitialLeadDraftOptions");
    expect(coreStart).toBeGreaterThan(0);
    expect(wrapperStart).toBeGreaterThan(coreStart);
    expect(initialStart).toBeGreaterThan(wrapperStart);
    expect(source.match(/async function runManagedAgentSession\(/g)).toHaveLength(1);
    // Permit only these named additions; original hashes still protect everything else.
    const prefix = source.slice(source.indexOf("export const EXISTING_AGENT_ID"), coreStart)
      .replace('/** Model every session runs on, set per session. The saved agent is not changed; its other model settings\n * (effort etc.) are copied unchanged. Roll back by setting this to "claude-opus-5-5". */\nexport const SESSION_MODEL_ID = "claude-sonnet-5-5";\n', "")
      .replace("/** Private session overrides used only by the dedicated first-lead entrypoint. */\ninterface SessionRunOptions extends RunOptions {\n  systemOverride?: string;\n  allowEmptyTools?: true;\n}\n", "")
      .replace("function customTools(backend: Backend, allowEmptyTools = false)", "function customTools(backend: Backend)")
      .replace("(backend.tools.length === 0 && !allowEmptyTools)", "backend.tools.length === 0")
      .replace("if (signal.aborted) {\n    // The operation/hook was evaluated before this helper. Observe late failure\n    // even when cancellation wins before Promise.race can attach its handlers.\n    void promise.catch(() => undefined);\n    throw new ManagedAgentDemoError(\"CANCELLED\", sessionId);\n  }",
        "if (signal.aborted) throw new ManagedAgentDemoError(\"CANCELLED\", sessionId);");
    const core = source.slice(coreStart, wrapperStart)
      .replace("    const sessionModel: ObjectValue = { ...(base.model as ObjectValue), id: SESSION_MODEL_ID };\n", "")
      .replace("version: EXISTING_AGENT_VERSION, model: sessionModel, tools,", "version: EXISTING_AGENT_VERSION, tools,")
      .replace("!object(resolved.model) || Object.keys(sessionModel).some(key => canonical((resolved.model as ObjectValue)[key]) !== canonical(sessionModel[key])) ||",
        "canonical(resolved.model) !== canonical(base.model) ||")
      .replace("options: SessionRunOptions", "options: RunOptions")
      .replace("customTools(options.backend, options.allowEmptyTools === true)", "customTools(options.backend)")
      .replace("version: EXISTING_AGENT_VERSION, tools, mcp_servers: [], skills: [],\n        ...(options.systemOverride === undefined ? {} : { system: options.systemOverride }) },",
        "version: EXISTING_AGENT_VERSION, tools, mcp_servers: [], skills: [] },")
      .replace("canonical(resolved.model) !== canonical(base.model) ||\n        resolved.system !== (options.systemOverride === undefined ? base.system : options.systemOverride) ||",
        "canonical(resolved.model) !== canonical(base.model) || resolved.system !== base.system ||");
    expect(digest(prefix)).toBe("f093140f0dfdf4eb8b0ea75251fabe70d3d1feae110ab1c731a04efce18fb045");
    expect(digest(core)).toBe("c5c12cdbdf66633e1f6e6b4674e60ec414be3f119f8fff4a4f5cc587687eb575");
    expect(digest(source.slice(wrapperStart, initialStart))).toBe("109455bb2148cc2bb6286fa064698d723759f48c3e45c332305d096744346b86");
  });
});
