import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagedReviewGenerator, REVIEW_AGENT_ID, REVIEW_AGENT_VERSION, REVIEW_ENVIRONMENT_ID } from "./managedAgent";
import { REVIEW_AGENT_NAME, REVIEW_RESPONSE_CAPABILITY, REVIEW_RESPONSE_USER_PROMPT, REVIEW_RESPONSE_DRAFT_BOUNDARY, publicReviewSchema, type ReviewGenerationInput } from "../../shared/reviewResponses";
const SYS = REVIEW_RESPONSE_USER_PROMPT + "\n\n" + REVIEW_RESPONSE_DRAFT_BOUNDARY;
const input: ReviewGenerationInput = { requestId: "request1", review: publicReviewSchema.parse({ platform: "google", accountId: "a", businessId: "b", reviewId: "r", rating: 5,
  reviewerName: "Synthetic reviewer", text: "The kitchen sparkled.", createdAt: "2026-11-20T12:00:00Z" }), recentResponses: [], bookingContext: null };
const result = { requestId: "request1", reviewId: "r", responseText: "Thanks for mentioning the kitchen. It is lovely to hear it sparkled and that the work made a difference for you. Glad you shared it.", groundingQuotes: ["The kitchen sparkled."], safetyFlags: [], unsupportedClaims: [] };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
function fixture(options: { base?: Record<string, unknown>; session?: Record<string, unknown>; output?: unknown; tool?: boolean; ambiguousPost?: boolean; incomplete?: boolean } = {}) {
  const base = { id: REVIEW_AGENT_ID, type: "agent", version: REVIEW_AGENT_VERSION, name: REVIEW_AGENT_NAME, system: SYS, archived_at: null,
    model: { id: "mock-inherited-model", effort: { type: "low" }, speed: "standard" }, multiagent: null, tools: [], mcp_servers: [], skills: [],
    metadata: { capability: REVIEW_RESPONSE_CAPABILITY }, ...options.base };
  const session = { id: "sesn_OfflineReviewOnly", type: "session", agent: base, environment_id: REVIEW_ENVIRONMENT_ID, archived_at: null, status: "idle",
    budget: null, resources: [], vault_ids: [], deployment_id: null, ...options.session };
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    expect(new URL(url).origin).toBe("https://api.anthropic.com"); expect(init.redirect).toBe("error");
    calls.push({ path, method, body });
    if (path === `/v1/agents/${REVIEW_AGENT_ID}` && method === "GET") return json(base);
    if (path === `/v1/environments/${REVIEW_ENVIRONMENT_ID}`) return json({ id: REVIEW_ENVIRONMENT_ID, type: "environment", archived_at: null, config: { type: "cloud" } });
    if (path === "/v1/sessions") { if (options.ambiguousPost) throw Error("synthetic timeout with sensitive body"); return json(session); }
    if (path.endsWith("/events/stream")) return new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { "content-type": "text/event-stream" } });
    if (path.endsWith("/events") && method === "POST") {
      const sent = body.events[0];
      const emit = (e: any) => { const frame = `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`; for (const b of new TextEncoder().encode(frame)) stream.enqueue(new Uint8Array([b])); };
      if (options.tool) emit({ id: "evt_tool", type: "agent.custom_tool_use", name: "publish_review", input: {} });
      else {
        emit({ id: "evt_msg", type: "agent.message", content: [{ type: "text", text: typeof options.output === "string" ? options.output : JSON.stringify(options.output ?? result) }] });
        if (!options.incomplete) emit({ id: "evt_idle", type: "session.status_idle", stop_reason: { type: "end_turn" }, stop_details: null });
      }
      stream.close(); return json({ data: [{ ...sent, id: "evt_echo", processed_at: "2026-11-20T12:00:00Z" }] });
    }
    throw Error("Unexpected mocked request");
  });
  vi.stubGlobal("fetch", fetcher); return { calls, fetcher };
}
beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "offline-mocked-key-not-real"));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("dedicated review Claude transport — no real sessions", () => {
  it("pins only the new identity, uses no tools or prompt/model overrides and returns bound JSON", async () => {
    const f = fixture(); const got = await createManagedReviewGenerator().generate(input); expect(got).toEqual(result);
    const create = f.calls.find(c => c.path === "/v1/sessions")!;
    expect(create.body.agent).toEqual({ type: "agent_with_overrides", id: REVIEW_AGENT_ID, version: 1, tools: [], mcp_servers: [], skills: [] });
    expect(create.body.agent.model).toBeUndefined(); expect(create.body.agent.system).toBeUndefined();
    expect(f.calls.every(c => !c.path.includes("agent_01Naiw8VvfB75yd2VWUtVP6v"))).toBe(true);
  });
  it("never sends private booking identifiers or exclusion terms to the model", async () => {
    const f = fixture(); await createManagedReviewGenerator().generate({ ...input, bookingContext: { verified: true, matchMethod: "explicit_booking_link", bookingId: "PRIVATE_BOOKING_ID", serviceType: "standard cleaning", privateTermsToExclude: ["PRIVATE_ADDRESS", "PRIVATE_PHONE"] } });
    const sent = JSON.stringify(f.calls.find(c => c.path.endsWith("/events"))!.body);
    expect(sent).not.toContain("PRIVATE_BOOKING_ID"); expect(sent).not.toContain("PRIVATE_ADDRESS"); expect(sent).not.toContain("PRIVATE_PHONE");
  });
  it.each([{ id: "wrong" }, { version: 2 }, { system: "drifted" }, { tools: [{ type: "agent_toolset_20260401" }] }, { metadata: {} }, { mcp_servers: [{ type: "url" }] }, { multiagent: { type: "coordinator" } }])("rejects saved identity/capability drift before creating a session %j", async base => {
    const f = fixture({ base }); await expect(createManagedReviewGenerator().generate(input)).rejects.toThrow(); expect(f.calls.some(c => c.method === "POST")).toBe(false);
  });
  it("rejects an unsafe resolved session before sending the review", async () => {
    const f = fixture({ session: { resources: [{ id: "resource" }] } }); await expect(createManagedReviewGenerator().generate(input)).rejects.toMatchObject({ code: "SESSION_MISMATCH" });
    expect(f.calls.some(c => c.path.endsWith("/events"))).toBe(false);
  });
  it("refuses unexpected tools without acknowledging or executing them", async () => {
    const f = fixture({ tool: true }); await expect(createManagedReviewGenerator().generate(input)).rejects.toMatchObject({ code: "UNSAFE_TOOL" });
    expect(f.calls.filter(c => c.path.endsWith("/events"))).toHaveLength(1);
  });
  it("does not retry a POST with an ambiguous result or expose exception details", async () => {
    const f = fixture({ ambiguousPost: true }); await expect(createManagedReviewGenerator().generate(input)).rejects.toMatchObject({ code: "UNKNOWN_POST_OUTCOME", message: "Review agent draft stopped: UNKNOWN_POST_OUTCOME" });
    expect(f.calls.filter(c => c.path === "/v1/sessions")).toHaveLength(1);
  });
  it.each(["not JSON", { ...result, requestId: "other" }, { ...result, reviewId: "wrong" }, { ...result, additionalField: "bad" }])("rejects malformed or wrong-binding output", async output => {
    fixture({ output }); await expect(createManagedReviewGenerator().generate(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("fails a truncated stream without completion evidence", async () => { fixture({ incomplete: true }); await expect(createManagedReviewGenerator().generate(input)).rejects.toMatchObject({ code: "INCOMPLETE_TURN" }); });
});
