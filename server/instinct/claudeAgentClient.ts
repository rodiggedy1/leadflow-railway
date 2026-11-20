/**
 * Verified saved-agent transport for optional human-reviewed SMS drafts.
 * Importing this file performs no I/O. Runtime uses only global fetch and the
 * caller's ANTHROPIC_API_KEY environment variable; no application wiring exists.
 * Official wire definitions: Managed Agents sessions/tools/events-and-streaming
 * and anthropics/anthropic-sdk-typescript src/resources/beta/{agents,sessions}.
 */
export const EXISTING_AGENT_ID = "agent_01Naiw8VvfB75yd2VWUtVP6v";
export const EXISTING_AGENT_VERSION = 1;
export const EXISTING_ENVIRONMENT_ID = "env_01U7m4FNwLv7iecyqyKfFFsW";
export const ANTHROPIC_VERSION = "2026-10-21";
export const ANTHROPIC_BETA = "managed-agents-2026-04-01";
const ORIGIN = "https://api.anthropic.com";

type ObjectValue = Record<string, unknown>;
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ObjectValue;
}
export interface Backend {
  tools: Array<ToolDefinition>;
  /** Return confirmed JSON only. Reject on HTTP ambiguity/unknown mutation outcome.
   * The backend owns schema validation, synthetic-only authority and idempotency.
   * Provider acknowledgement receipts below do NOT assert business success.
   */
  callTool(name: string, input: ObjectValue, providerEventId: string): Promise<unknown>;
}
/** Safe projections only: never config, prompt, auth headers or error bodies. */
export interface ObservedEvent {
  id: string;
  type: string;
  name?: string;
  input?: ObjectValue;
  texts?: string[];
  stopReason?: string;
}
export interface TraceEntry {
  stage: "http_response" | "configuration_verified" | "session_created" |
    "session_verified" | "tool_started" | "tool_result_acknowledged" |
    "tool_replay_suppressed" | "completed" | "failed";
  sessionId?: string;
  method?: "GET" | "POST";
  path?: string;
  status?: number;
  providerEventId?: string;
  toolName?: string;
  code?: ClientErrorCode;
}
export interface RunOptions {
  /** Must be the isolated synthetic backend, never a production dispatch adapter. */
  backend: Backend;
  /** Verbatim simulated-SMS context; this client adds no system/model overrides. */
  simulatedPayload: string;
  signal?: AbortSignal;
  onEvent?: (event: ObservedEvent) => void | Promise<void>;
  onTrace?: (entry: TraceEntry) => void | Promise<void>;
}
/** Private session overrides used only by the dedicated first-lead entrypoint. */
interface SessionRunOptions extends RunOptions {
  systemOverride?: string;
  allowEmptyTools?: true;
}
export interface ToolReceipt {
  providerEventId: string;
  name: string;
  resultJson: string;
  resultEventId: string;
  delivery: "acknowledged";
  /** An identical replay reuses this receipt locally once; never resends a POST. */
  replayMetadataReused: boolean;
}
export interface RunResult {
  sessionId: string;
  agentId: typeof EXISTING_AGENT_ID;
  agentVersion: typeof EXISTING_AGENT_VERSION;
  environmentId: typeof EXISTING_ENVIRONMENT_ID;
  agentMessages: Array<{ providerEventId: string; text: string }>;
  /** Last buffered agent.message text; a simulated SMS, NOT proof of SMS delivery. */
  finalSmsText: string;
  toolCalls: ToolReceipt[];
}
export type ClientErrorCode = "MISSING_API_KEY" | "INVALID_BACKEND" |
  "INVALID_PAYLOAD" | "AGENT_MISMATCH" | "UNSAFE_AGENT" |
  "ENVIRONMENT_MISMATCH" | "SESSION_MISMATCH" | "PROVIDER_HTTP_ERROR" |
  "PROVIDER_TRANSPORT_ERROR" | "UNKNOWN_POST_OUTCOME" | "INVALID_RESPONSE" |
  "INVALID_EVENT" | "PROVIDER_SESSION_ERROR" | "UNSAFE_TOOL" |
  "TOOL_OUTCOME_UNKNOWN" | "REPLAY_CONFLICT" | "INCOMPLETE_TURN" |
  "CANCELLED" | "HOOK_FAILED";
export class ManagedAgentDemoError extends Error {
  readonly name = "ManagedAgentDemoError";
  constructor(
    public readonly code: ClientErrorCode,
    public readonly sessionId?: string,
    public readonly status?: number,
    public readonly outcome: "not_started" | "rejected" | "unknown" = "unknown",
  ) {
    // No provider/backend exception, error body, request header or key is retained.
    super(`Isolated Managed Agent demo stopped: ${code}`);
  }
}

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
/** Canonical JSON comparison ignores object-key order, not types or array order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Not JSON");
  return encoded;
}
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
const RESERVED_NAMES = new Set([
  "bash", "read", "write", "edit", "glob", "grep", "web_fetch", "web_search",
]);
function customTools(backend: Backend, allowEmptyTools = false): Array<ToolDefinition & { type: "custom" }> {
  if (!backend || typeof backend.callTool !== "function" || !Array.isArray(backend.tools) ||
      (backend.tools.length === 0 && !allowEmptyTools)) throw new ManagedAgentDemoError("INVALID_BACKEND", undefined, undefined, "not_started");
  const names = new Set<string>();
  return backend.tools.map(tool => {
    if (!object(tool) || !nonempty(tool.name) || !/^[A-Za-z0-9_-]{1,128}$/.test(tool.name) ||
        RESERVED_NAMES.has(tool.name) || /^(mcp__|ant__)/.test(tool.name) ||
        names.has(tool.name) || !nonempty(tool.description) ||
        !object(tool.input_schema) || tool.input_schema.type !== "object" ||
        Object.keys(tool).some(key => !["name", "description", "input_schema"].includes(key))) {
      throw new ManagedAgentDemoError("INVALID_BACKEND", undefined, undefined, "not_started");
    }
    names.add(tool.name);
    try {
      return { type: "custom", name: tool.name, description: tool.description,
        input_schema: jsonClone(tool.input_schema) };
    } catch {
      throw new ManagedAgentDemoError("INVALID_BACKEND", undefined, undefined, "not_started");
    }
  });
}
function sameTools(value: unknown, expected: Array<ToolDefinition & { type: "custom" }>): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  if (!value.every(tool => object(tool) && tool.type === "custom" && nonempty(tool.name))) return false;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return canonical([...value].sort(byName)) === canonical([...expected].sort(byName));
}
function emptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}
/** Cancel waiting locally. Cannot undo an already-started backend mutation. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal, sessionId?: string): Promise<T> {
  if (signal.aborted) throw new ManagedAgentDemoError("CANCELLED", sessionId);
  let listener: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    listener = () => reject(new ManagedAgentDemoError("CANCELLED", sessionId));
    signal.addEventListener("abort", listener, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { if (listener) signal.removeEventListener("abort", listener); }
}

interface SseFrame { event: string | null; data: string }
/** SSE parser: UTF-8 chunks, CR/LF/CRLF boundaries, comments and multiline data. */
async function* frames(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal,
  sessionId: string): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "", event: string | null = null;
  let data: string[] = [];
  function takeLine(line: string): SseFrame | undefined {
    if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    if (line === "") {
      const frame = event !== null || data.length ? { event, data: data.join("\n") } : undefined;
      event = null; data = [];
      return frame;
    }
    const colon = line.indexOf(":");
    if (colon === 0) return;
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(line[colon + 1] === " " ? colon + 2 : colon + 1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await abortable(reader.read(), signal, sessionId); }
    catch (error) {
      if (error instanceof ManagedAgentDemoError) throw error;
      throw new ManagedAgentDemoError("PROVIDER_TRANSPORT_ERROR", sessionId);
    }
    try { text += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }); }
    catch { throw new ManagedAgentDemoError("INVALID_EVENT", sessionId); }
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char !== "\n" && char !== "\r") continue;
      if (char === "\r" && i + 1 === text.length && !chunk.done) break;
      const frame = takeLine(text.slice(start, i));
      if (char === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
      if (frame) yield frame;
    }
    text = text.slice(start);
    if (chunk.done) return; // Unterminated frame is not evidence of completion.
  }
}

/** Creates only a NEW session; never accepts an existing session ID. No retries. */
async function runManagedAgentSession(options: SessionRunOptions): Promise<RunResult> {
  const tools = customTools(options.backend, options.allowEmptyTools === true);
  if (!nonempty(options.simulatedPayload)) {
    throw new ManagedAgentDemoError("INVALID_PAYLOAD", undefined, undefined, "not_started");
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.trim()) throw new ManagedAgentDemoError("MISSING_API_KEY", undefined, undefined, "not_started");
  const controller = new AbortController();
  const signal = controller.signal;
  let sessionId: string | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const checkCancelled = () => {
    if (signal.aborted) throw new ManagedAgentDemoError("CANCELLED", sessionId);
  };
  async function trace(entry: TraceEntry): Promise<void> {
    if (!options.onTrace) return;
    try { await abortable(Promise.resolve(options.onTrace({ ...entry })), signal, sessionId); }
    catch (error) {
      if (error instanceof ManagedAgentDemoError && error.code === "CANCELLED") throw error;
      throw new ManagedAgentDemoError("HOOK_FAILED", sessionId);
    }
  }
  async function observe(event: ObservedEvent): Promise<void> {
    if (!options.onEvent) return;
    try { await abortable(Promise.resolve(options.onEvent(jsonClone(event))), signal, sessionId); }
    catch (error) {
      if (error instanceof ManagedAgentDemoError && error.code === "CANCELLED") throw error;
      throw new ManagedAgentDemoError("HOOK_FAILED", sessionId);
    }
  }
  async function request(method: "GET" | "POST", path: string, body?: unknown,
    streaming = false): Promise<Response> {
    checkCancelled();
    let response: Response;
    try {
      response = await abortable(globalThis.fetch(`${ORIGIN}${path}`, {
        method, redirect: "error", signal,
        headers: {
          "x-api-key": key!, "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-beta": ANTHROPIC_BETA,
          ...(streaming ? { accept: "text/event-stream" } : { accept: "application/json" }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), signal, sessionId);
    } catch (error) {
      if (error instanceof ManagedAgentDemoError && error.code === "CANCELLED") throw error;
      throw new ManagedAgentDemoError(method === "POST" ? "UNKNOWN_POST_OUTCOME" :
        "PROVIDER_TRANSPORT_ERROR", sessionId);
    }
    await trace({ stage: "http_response", method, path, status: response.status, sessionId });
    if (!response.ok) {
      // Never consume/log an error body. Every POST failure stops without a retry.
      void response.body?.cancel().catch(() => undefined);
      const ambiguous = method === "POST" && (response.status >= 500 || response.status === 408);
      throw new ManagedAgentDemoError(ambiguous ? "UNKNOWN_POST_OUTCOME" : "PROVIDER_HTTP_ERROR",
        sessionId, response.status, ambiguous ? "unknown" : "rejected");
    }
    return response;
  }
  async function jsonRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<ObjectValue> {
    const response = await request(method, path, body);
    try {
      const value: unknown = await abortable(response.json(), signal, sessionId);
      if (!object(value)) throw new Error("Object required");
      return value;
    } catch (error) {
      if (error instanceof ManagedAgentDemoError && error.code === "CANCELLED") throw error;
      throw new ManagedAgentDemoError(method === "POST" ? "UNKNOWN_POST_OUTCOME" : "INVALID_RESPONSE", sessionId);
    }
  }
  // Send acknowledgement is checked, not inferred from HTTP success alone.
  async function send(event: ObjectValue): Promise<string> {
    const reply = await jsonRequest("POST", `/v1/sessions/${sessionId}/events`, { events: [event] });
    if (!Array.isArray(reply.data) || reply.data.length !== 1 || !object(reply.data[0])) {
      throw new ManagedAgentDemoError("UNKNOWN_POST_OUTCOME", sessionId);
    }
    const echo = reply.data[0];
    if (!nonempty(echo.id) || echo.type !== event.type ||
        !Array.isArray(echo.content) || canonical(echo.content) !== canonical(event.content) ||
        (event.type === "user.custom_tool_result" &&
          (echo.custom_tool_use_id !== event.custom_tool_use_id || !nonempty(echo.processed_at) || echo.is_error === true))) {
      throw new ManagedAgentDemoError("UNKNOWN_POST_OUTCOME", sessionId);
    }
    return echo.id;
  }
  try {
    checkCancelled();
    const base = await jsonRequest("GET", `/v1/agents/${EXISTING_AGENT_ID}`);
    if (base.type !== "agent" || base.id !== EXISTING_AGENT_ID || base.version !== EXISTING_AGENT_VERSION ||
        base.archived_at !== null || !object(base.model) || !nonempty(base.model.id) ||
        !(base.system === null || typeof base.system === "string")) {
      throw new ManagedAgentDemoError("AGENT_MISMATCH", undefined, undefined, "not_started");
    }
    // A session-local tools override cannot isolate a separate predefined agent.
    // Do not silently disable/modify saved orchestration: refuse instead.
    if (base.multiagent !== null) throw new ManagedAgentDemoError("UNSAFE_AGENT", undefined, undefined, "not_started");
    const environment = await jsonRequest("GET", `/v1/environments/${EXISTING_ENVIRONMENT_ID}`);
    if (environment.type !== "environment" || environment.id !== EXISTING_ENVIRONMENT_ID ||
        environment.archived_at !== null || !object(environment.config) ||
        !["cloud", "self_hosted"].includes(String(environment.config.type))) {
      throw new ManagedAgentDemoError("ENVIRONMENT_MISMATCH", undefined, undefined, "not_started");
    }
    await trace({ stage: "configuration_verified" });
    const session = await jsonRequest("POST", "/v1/sessions", {
      agent: { type: "agent_with_overrides", id: EXISTING_AGENT_ID,
        version: EXISTING_AGENT_VERSION, tools, mcp_servers: [], skills: [],
        ...(options.systemOverride === undefined ? {} : { system: options.systemOverride }) },
      environment_id: EXISTING_ENVIRONMENT_ID,
    });
    if (nonempty(session.id) && /^sesn_[A-Za-z0-9]+$/.test(session.id)) sessionId = session.id;
    if (!sessionId) throw new ManagedAgentDemoError("SESSION_MISMATCH");
    await trace({ stage: "session_created", sessionId });
    const resolved = session.agent;
    if (session.type !== "session" || session.environment_id !== EXISTING_ENVIRONMENT_ID ||
        session.status !== "idle" || session.archived_at !== null || session.budget !== null ||
        !emptyArray(session.resources) || !emptyArray(session.vault_ids) ||
        (session.deployment_id !== undefined && session.deployment_id !== null) ||
        !object(resolved) || resolved.type !== "agent" || resolved.id !== EXISTING_AGENT_ID ||
        resolved.version !== EXISTING_AGENT_VERSION || resolved.multiagent !== null ||
        canonical(resolved.model) !== canonical(base.model) ||
        resolved.system !== (options.systemOverride === undefined ? base.system : options.systemOverride) ||
        !sameTools(resolved.tools, tools) || !emptyArray(resolved.mcp_servers) || !emptyArray(resolved.skills)) {
      throw new ManagedAgentDemoError("SESSION_MISMATCH", sessionId);
    }
    await trace({ stage: "session_verified", sessionId });
    const stream = await request("GET", `/v1/sessions/${sessionId}/events/stream`, undefined, true);
    if (!stream.body || !stream.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
      void stream.body?.cancel().catch(() => undefined);
      throw new ManagedAgentDemoError("INVALID_RESPONSE", sessionId);
    }
    reader = stream.body.getReader(); // Open BEFORE message; provider emits only subsequent events.
    const sentMessageId = await send({ type: "user.message",
      content: [{ type: "text", text: options.simulatedPayload }] });
    const calls = new Map<string, { signature: string; receipt: ToolReceipt }>();
    const seen = new Map<string, string>();
    const agentMessages: RunResult["agentMessages"] = [];
    const toolNames = new Set(tools.map(tool => tool.name));
    for await (const frame of frames(reader, signal, sessionId)) {
      checkCancelled();
      if (frame.event === "ping" || frame.event === null || frame.data === "") continue;
      if (frame.event === "error") throw new ManagedAgentDemoError("PROVIDER_SESSION_ERROR", sessionId);
      let event: ObjectValue;
      try {
        const parsed: unknown = JSON.parse(frame.data);
        if (!object(parsed) || !nonempty(parsed.type) || !nonempty(parsed.id)) throw new Error("Event required");
        event = parsed;
      } catch { throw new ManagedAgentDemoError("INVALID_EVENT", sessionId); }
      const id = event.id as string, type = event.type as string;
      const signature = canonical(event);
      if (type === "agent.custom_tool_use") {
        if (!nonempty(event.name) || !toolNames.has(event.name) || !object(event.input) ||
            (event.session_thread_id !== undefined && event.session_thread_id !== null)) {
          throw new ManagedAgentDemoError("UNSAFE_TOOL", sessionId);
        }
        const callSignature = canonical({ name: event.name, input: event.input });
        const prior = calls.get(id);
        if (prior) {
          if (prior.signature !== callSignature) throw new ManagedAgentDemoError("REPLAY_CONFLICT", sessionId);
          if (!prior.receipt.replayMetadataReused) {
            prior.receipt.replayMetadataReused = true;
            await trace({ stage: "tool_replay_suppressed", sessionId, providerEventId: id, toolName: event.name });
          }
          continue; // Already acknowledged: no backend execution and no second POST.
        }
        if (seen.has(id)) throw new ManagedAgentDemoError("REPLAY_CONFLICT", sessionId);
        seen.set(id, signature);
        await observe({ id, type, name: event.name, input: event.input });
        await trace({ stage: "tool_started", sessionId, providerEventId: id, toolName: event.name });
        checkCancelled();
        let resultJson: string;
        try {
          const result = await abortable(Promise.resolve(options.backend.callTool(event.name,
            jsonClone(event.input), id)), signal, sessionId);
          const encoded = JSON.stringify(result);
          if (encoded === undefined) throw new Error("JSON result required");
          resultJson = encoded;
        } catch (error) {
          if (error instanceof ManagedAgentDemoError && error.code === "CANCELLED") throw error;
          // A thrown backend HTTP/timeout error cannot prove a mutation failed.
          throw new ManagedAgentDemoError("TOOL_OUTCOME_UNKNOWN", sessionId);
        }
        const resultEventId = await send({ type: "user.custom_tool_result", custom_tool_use_id: id,
          content: [{ type: "text", text: resultJson }] });
        calls.set(id, { signature: callSignature, receipt: { providerEventId: id, name: event.name,
          resultJson, resultEventId, delivery: "acknowledged", replayMetadataReused: false } });
        await trace({ stage: "tool_result_acknowledged", sessionId, providerEventId: id, toolName: event.name });
        continue;
      }
      if (seen.has(id)) {
        if (seen.get(id) !== signature) throw new ManagedAgentDemoError("REPLAY_CONFLICT", sessionId);
        continue;
      }
      seen.set(id, signature);
      if (["session.error", "session.status_terminated", "session.deleted", "session.status_rescheduled"].includes(type)) {
        // Error event bodies are not exposed through hooks.
        await observe({ id, type });
        throw new ManagedAgentDemoError("PROVIDER_SESSION_ERROR", sessionId);
      }
      if (["agent.tool_use", "agent.tool_result", "agent.mcp_tool_use", "agent.mcp_tool_result"].includes(type)) {
        throw new ManagedAgentDemoError("UNSAFE_TOOL", sessionId);
      }
      if (type === "agent.message") {
        if (!Array.isArray(event.content) || !event.content.every(block => object(block) &&
          ((block.type === "text" && typeof block.text === "string") || block.type === "redacted"))) {
          throw new ManagedAgentDemoError("INVALID_EVENT", sessionId);
        }
        const texts = event.content.filter(block => block.type === "text").map(block => block.text as string);
        agentMessages.push({ providerEventId: id, text: texts.join("") });
        await observe({ id, type, texts });
      } else if (type === "session.status_idle") {
        if (!object(event.stop_reason) || !nonempty(event.stop_reason.type)) {
          throw new ManagedAgentDemoError("INVALID_EVENT", sessionId);
        }
        await observe({ id, type, stopReason: event.stop_reason.type });
        if (event.stop_reason.type === "end_turn") {
          const finalSmsText = agentMessages.at(-1)?.text;
          if (!finalSmsText?.trim() || (event.stop_details !== undefined && event.stop_details !== null)) {
            throw new ManagedAgentDemoError("INCOMPLETE_TURN", sessionId);
          }
          await trace({ stage: "completed", sessionId });
          return { sessionId, agentId: EXISTING_AGENT_ID, agentVersion: EXISTING_AGENT_VERSION,
            environmentId: EXISTING_ENVIRONMENT_ID, agentMessages, finalSmsText,
            toolCalls: Array.from(calls.values(), entry => ({ ...entry.receipt })) };
        }
        if (event.stop_reason.type !== "requires_action" || !Array.isArray(event.stop_reason.event_ids) ||
            !event.stop_reason.event_ids.every(blockedId => typeof blockedId === "string" && calls.has(blockedId))) {
          throw new ManagedAgentDemoError("INCOMPLETE_TURN", sessionId);
        }
        // Results were already answered immediately, before this idle event.
      } else if (type === "user.message") {
        if (id !== sentMessageId || canonical(event.content) !== canonical([{ type: "text", text: options.simulatedPayload }])) {
          throw new ManagedAgentDemoError("INVALID_EVENT", sessionId);
        }
        await observe({ id, type });
      } else if (type === "user.custom_tool_result") {
        const prior = typeof event.custom_tool_use_id === "string" ? calls.get(event.custom_tool_use_id) : undefined;
        if (!prior || id !== prior.receipt.resultEventId || event.is_error === true ||
          canonical(event.content) !== canonical([{ type: "text", text: prior.receipt.resultJson }])) {
          throw new ManagedAgentDemoError("INVALID_EVENT", sessionId);
        }
        await observe({ id, type });
      } else if (type === "span.model_request_end") {
        if (event.is_error === true) throw new ManagedAgentDemoError("PROVIDER_SESSION_ERROR", sessionId);
        await observe({ id, type });
      } else if (["agent.thinking", "agent.thread_context_compacted", "session.status_running", "session.usage", "span.model_request_start"].includes(type)) {
        await observe({ id, type });
      } else if (["session.thread_created", "session.thread_status_running", "session.thread_status_idle"].includes(type)) {
        // Only the primary thread can exist: saved and resolved multiagent are null.
        if (event.agent_name !== base.name || (event.workflow_run_id !== undefined && event.workflow_run_id !== null)) {
          throw new ManagedAgentDemoError("UNSAFE_AGENT", sessionId);
        }
        await observe({ id, type });
      } else {
        // Do not infer success for unfamiliar outcomes, updates or tool families.
        throw new ManagedAgentDemoError("INVALID_EVENT", sessionId);
      }
    }
    throw new ManagedAgentDemoError("INCOMPLETE_TURN", sessionId);
  } catch (error) {
    const safe = error instanceof ManagedAgentDemoError ? error : new ManagedAgentDemoError("INVALID_RESPONSE", sessionId);
    // Failure hook is best-effort and has only fixed codes; it cannot change outcome.
    // Never wait on this notification: user cancellation must remain reliable.
    try {
      void Promise.resolve(options.onTrace?.({ stage: "failed", sessionId, code: safe.code })).catch(() => undefined);
    } catch { /* redacted */ }
    throw safe;
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", onAbort);
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

export interface GeneralSmsDraftOptions {
  readonly reviewOnly: true;
  readonly backend: Backend;
  readonly reviewPayload: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: RunOptions["onEvent"];
  readonly onTrace?: RunOptions["onTrace"];
}
/** General human-review drafting through the SAME saved agent/version/session
 * transport. One read-only context tool; no proposal, scheduling, write or send.
 * This passive entrypoint does not activate customer traffic or grant reads. */
export function runGeneralSmsDraft(options: GeneralSmsDraftOptions): Promise<RunResult> {
  if (options.reviewOnly !== true || !options.backend || !Array.isArray(options.backend.tools) ||
      options.backend.tools.length !== 1 || options.backend.tools[0].name !== "get_customer_context") {
    throw new ManagedAgentDemoError("INVALID_BACKEND", undefined, undefined, "not_started");
  }
  const backend: Backend = {
    tools: options.backend.tools,
    callTool(name, input, providerEventId) {
      if (name !== "get_customer_context") throw new ManagedAgentDemoError("UNSAFE_TOOL");
      return options.backend.callTool(name, input, providerEventId);
    },
  };
  return runManagedAgentSession({ backend, simulatedPayload: options.reviewPayload,
    signal: options.signal, onEvent: options.onEvent, onTrace: options.onTrace });
}

export interface InitialLeadDraftOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: RunOptions["onEvent"];
  readonly onTrace?: RunOptions["onTrace"];
}
/** First-lead drafting with exact caller instructions and no tools or business
 * operations. Replaces only the session system; never edits the saved agent. */
export function runInitialLeadDraft(options: InitialLeadDraftOptions): Promise<RunResult> {
  if (typeof options.systemPrompt !== "string") {
    throw new ManagedAgentDemoError("INVALID_PAYLOAD", undefined, undefined, "not_started");
  }
  const backend: Backend = {
    tools: [],
    callTool() { throw new ManagedAgentDemoError("UNSAFE_TOOL"); },
  };
  return runManagedAgentSession({ backend, simulatedPayload: options.userPrompt,
    systemOverride: options.systemPrompt, allowEmptyTools: true,
    signal: options.signal, onEvent: options.onEvent, onTrace: options.onTrace });
}

export interface WeeklyCommunicationReviewOptions {
  readonly reviewOnly: true;
  readonly backend: Backend;
  readonly systemPrompt: string;
  readonly reviewPayload: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: RunOptions["onEvent"];
  readonly onTrace?: RunOptions["onTrace"];
}
/** Dedicated weekly evidence review through the same saved agent/model/session
 * transport. Only immutable in-memory communication snapshot reads are exposed;
 * no customer-response drafting, business dispatch, sending or saved-agent edits. */
export function runWeeklyCommunicationReview(options: WeeklyCommunicationReviewOptions): Promise<RunResult> {
  const allowed = new Set(["get_weekly_review_manifest", "read_weekly_sms", "read_weekly_human_calls", "read_weekly_ai_calls", "read_weekly_emails"]);
  if (options.reviewOnly !== true || typeof options.systemPrompt !== "string" ||
      !options.backend || !Array.isArray(options.backend.tools) || options.backend.tools.length !== allowed.size ||
      new Set(options.backend.tools.map(tool => tool.name)).size !== allowed.size ||
      options.backend.tools.some(tool => !allowed.has(tool.name))) {
    throw new ManagedAgentDemoError("INVALID_BACKEND", undefined, undefined, "not_started");
  }
  const backend: Backend = {
    tools: options.backend.tools,
    callTool(name, input, providerEventId) {
      if (!allowed.has(name)) throw new ManagedAgentDemoError("UNSAFE_TOOL");
      return options.backend.callTool(name, input, providerEventId);
    },
  };
  return runManagedAgentSession({ backend, simulatedPayload: options.reviewPayload,
    systemOverride: options.systemPrompt, signal: options.signal,
    onEvent: options.onEvent, onTrace: options.onTrace });
}
