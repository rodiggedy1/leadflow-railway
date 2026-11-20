import { afterEach, describe, expect, it, vi } from "vitest";
import { runWeeklyCommunicationReview, EXISTING_AGENT_ID, EXISTING_AGENT_VERSION, EXISTING_ENVIRONMENT_ID, type Backend } from "./claudeAgentClient";
const names = ["get_weekly_review_manifest", "read_weekly_sms", "read_weekly_human_calls", "read_weekly_ai_calls", "read_weekly_emails"];
const tools = names.map(name => ({ name, description: "Synthetic read-only weekly evidence", input_schema: { type: "object", properties: {}, additionalProperties: false } }));
const options = (backend: Backend) => ({ reviewOnly: true as const, backend, systemPrompt: "Synthetic weekly review only", reviewPayload: "Review the synthetic Sunday week" });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("weekly review saved-agent transport", () => {
  it.each(["send_sms", "write", "read", "reschedule"]) ("rejects forbidden tool %s before provider access", name => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(() => runWeeklyCommunicationReview(options({ tools: [...tools.slice(0, 4), { ...tools[4], name }], callTool: vi.fn() }))).toThrow("INVALID_BACKEND");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires the exact five tools and explicit review-only mode", () => {
    expect(() => runWeeklyCommunicationReview(options({ tools: tools.slice(0, 4), callTool: vi.fn() }))).toThrow("INVALID_BACKEND");
    expect(() => runWeeklyCommunicationReview({ ...options({ tools, callTool: vi.fn() }), reviewOnly: false } as any)).toThrow("INVALID_BACKEND");
    expect(() => runWeeklyCommunicationReview(options({ tools: [tools[0], tools[0], ...tools.slice(2)], callTool: vi.fn() }))).toThrow("INVALID_BACKEND");
  });
  it("uses one inherited-model session and exposes all communication read tools without changing the saved agent", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-not-a-key");
    const sessionId = "sesn_SyntheticWeeklyReview01";
    const base = { type: "agent", id: EXISTING_AGENT_ID, version: EXISTING_AGENT_VERSION, archived_at: null, model: { id: "inherited-synthetic-model" }, system: "Original customer prompt", multiagent: null, name: "Synthetic agent" };
    const backendCall = vi.fn(async (_name: string, _input: Record<string, unknown>, _eventId: string) => ({ synthetic: true, nextOffset: null }));
    const backend = { tools, callTool: backendCall };
    let stream: ReadableStreamDefaultController<Uint8Array>; let current = 0; let echo = 0;
    const calls: Array<{ method: string; path: string; body: any }> = [];
    const frame = (value: any) => stream.enqueue(new TextEncoder().encode(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`));
    const next = () => {
      if (current < names.length) frame({ id: "sevt_tool" + current, type: "agent.custom_tool_use", name: names[current], input: {} });
      else {
        frame({ id: "sevt_result", type: "agent.message", content: [{ type: "text", text: '{"candidates":[]}' }] });
        frame({ id: "sevt_complete", type: "session.status_idle", stop_reason: { type: "end_turn" }, stop_details: null });
      }
    };
    const json = (v: any) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url); const method = init.method!; const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: u.pathname, body });
      expect(u.origin).toBe("https://api.anthropic.com");
      if (u.pathname === `/v1/agents/${EXISTING_AGENT_ID}`) return json(base);
      if (u.pathname === `/v1/environments/${EXISTING_ENVIRONMENT_ID}`) return json({ type: "environment", id: EXISTING_ENVIRONMENT_ID, archived_at: null, config: { type: "cloud" } });
      if (u.pathname === "/v1/sessions") return json({ type: "session", id: sessionId, agent: { ...base, system: options(backend).systemPrompt, tools: tools.map(t => ({ type: "custom", ...t })), mcp_servers: [], skills: [] }, environment_id: EXISTING_ENVIRONMENT_ID, status: "idle", archived_at: null, resources: [], vault_ids: [], budget: null });
      if (u.pathname.endsWith("/events/stream")) return new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } }), { headers: { "content-type": "text/event-stream" } });
      if (u.pathname.endsWith("/events")) {
        const sent = body.events[0];
        if (sent.type === "user.message") next();
        else { current++; next(); }
        return json({ data: [{ ...sent, id: "sevt_echo" + (++echo), processed_at: "2026-11-20T04:00:00Z" }] });
      }
      throw new Error("Unexpected provider request");
    }));
    const result = await runWeeklyCommunicationReview(options(backend));
    expect(result.finalSmsText).toBe('{"candidates":[]}'); expect(result.sessionId).toBe(sessionId);
    expect(backendCall.mock.calls.map(c => c[0])).toEqual(names);
    const created = calls.filter(c => c.method === "POST" && c.path === "/v1/sessions");
    expect(created).toHaveLength(1); expect(created[0].body.agent.id).toBe(EXISTING_AGENT_ID);
    expect(created[0].body.agent.version).toBe(EXISTING_AGENT_VERSION);
    expect(created[0].body.agent.model).toBeUndefined(); expect(created[0].body.agent.system).toBe(options(backend).systemPrompt);
    expect(calls.some(c => c.path.includes("/v1/agents/") && c.method !== "GET")).toBe(false);
  });
});
