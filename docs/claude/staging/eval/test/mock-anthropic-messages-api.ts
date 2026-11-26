// TEST ONLY: a local fake of the Anthropic endpoints messages-api-compare.ts uses (saved-agent sessions AND the direct
// Messages API, with a simulated prompt cache), filled with invented requests of every kind.
// Usage: pnpm exec tsx docs/claude/staging/eval/test/mock-anthropic-messages-api.ts <port>
import http from "node:http";
import { CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS } from "../../../../../server/instinct/claudeCustomerCalls";
import { CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS } from "../../../../../server/instinct/claudeStaffCalls";
import { TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS } from "../../../../../server/teamLeaderboardComplaintDetect";

const port = Number(process.argv[2] || 8789);
const AGENT_ID = "agent_01Naiw8VvfB75yd2VWUtVP6v", ENV_ID = "env_01U7m4FNwLv7iecyqyKfFFsW";
const SMS = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===\n(mock SMS instructions, long enough to cache)";
const SMS_OLD = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===\n(mock older SMS instructions)";
const EMAIL = "=== CURRENT CAPABILITY — HIGHEST PRIORITY ===\n(mock email instructions)";
const WRITING = "(mock CS writing prompt used for Thumbtack first responses)";
const now = Date.now(); let seq = 0;
const iso = (ms: number) => new Date(ms).toISOString();
const log = { sessionsCreated: 0, direct: [] as any[], judges: 0, agentWrites: 0, authHeaders: new Set<string>() };

type Obj = Record<string, any>;
const smsPayload = (i: number, inbound: string) => ({ incomingMessage: inbound, context: {
  binding: { fromPhone: "+12025550101", customerName: `Test Customer ${i}` }, contact: { displayName: `Test Customer ${i}` },
  originalConversation: [{ turnIndex: 0, role: "assistant", content: "Hi! How can we help?", ts: now - 7200_000 }, { turnIndex: 1, role: "user", content: inbound, ts: now - 3600_000 }],
  earlierMessagesOmitted: 0, receivingPhoneNumber: "+12025550199", bookingContext: null, openStaffTasks: [], unavailableRecords: [],
  smsBookingQuote: { state: null, currentLocalDate: "2026-11-20", currentLocalTime: "10:00" } } });
const callSource = (t: string) => ({ source: { providerCallId: "call_mock", transcript: `User: ${t}\nAI: Sure, I'll pass that on.` } });
const complaintSource = { source: { id: "ev1", revision: "r1", originalText: "The team was great, thanks!", bodyBasis: "original", limitations: [], speakerBasis: "customer" } };

function output(system: string, user: string, arm: "managed" | "direct", attempt: number): string {
  if (system.startsWith("=== SMS")) {
    const inbound = JSON.parse(user).incomingMessage as string;
    if (inbound.startsWith("Please move")) {
      if (arm === "direct" && attempt === 1) return "not json"; // exercises the single retry
      return JSON.stringify({ replyText: "Got it! A team member will look at moving your cleaning to Friday.", task: { title: "Reschedule cleaning",
        items: [{ title: "Move the cleaning to Friday", evidenceQuote: "move my cleaning to Friday" }] }, bookingQuote: null, quotePresentationLanguage: null });
    }
    return JSON.stringify({ replyText: "Yes, we bring all our own supplies!", task: null, bookingQuote: null, quotePresentationLanguage: null });
  }
  if (system === EMAIL) return JSON.stringify({ replyText: "Thanks for your email, we'll take a look.", task: null });
  if (system === CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS || system === CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS) {
    if (user.includes("call me back")) return JSON.stringify({ task: { title: "Call back", items: [{ title: "Call the customer back", evidenceQuote: arm === "managed" ? "call me back" : "an invented quote" } ] } });
    return JSON.stringify({ task: null });
  }
  if (system === TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS) return JSON.stringify({ candidates: [] });
  return "Hi Sam! Thanks for reaching out to Maids in Black. How many bedrooms and bathrooms is your home?";
}

// ----- saved-agent sessions -----
const sessions = new Map<string, Obj>(), events = new Map<string, Obj[]>(), streams = new Map<string, http.ServerResponse[]>();
const attempts = new Map<string, number>();
function historySession(system: string, userText: string, minutesAgo: number) {
  const id = `sesn_${++seq}`, created = now - minutesAgo * 60_000;
  sessions.set(id, { type: "session", id, status: "idle", created_at: iso(created), archived_at: null,
    agent: { type: "agent", id: AGENT_ID, version: 1, system, model: { id: "claude-sonnet-5-5", effort: "low" }, tools: [], mcp_servers: [], skills: [] }, environment_id: ENV_ID });
  events.set(id, [
    { id: `ev${++seq}`, type: "user.message", content: [{ type: "text", text: userText }], processed_at: iso(created + 100) },
    { id: `ev${++seq}`, type: "agent.message", content: [{ type: "text", text: "{}" }], processed_at: iso(created + 4000) },
    { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, processed_at: iso(created + 4100) },
  ]);
}
const INBOUND = ["Do you bring your own supplies?", "Please move my cleaning to Friday", "Do you clean ovens?", "Thanks!"];
INBOUND.forEach((t, i) => historySession(SMS, JSON.stringify(smsPayload(i, t)), 300 - i));
historySession(SMS, JSON.stringify(smsPayload(1, INBOUND[1])), 296); // a production retry of the same request
historySession(SMS_OLD, JSON.stringify(smsPayload(9, "older")), 400);
historySession(EMAIL, JSON.stringify({ incomingMessage: "Can I change my email address?", context: {} }), 250);
historySession(CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS, JSON.stringify(callSource("Please call me back about Friday")), 240);
historySession(CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS, JSON.stringify(callSource("What time do you arrive?")), 239);
historySession(CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS, JSON.stringify(callSource("Thanks, that's all")), 230);
historySession(TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS, JSON.stringify(complaintSource), 220);
historySession(WRITING, "Customer's first name: Sam\n\nCustomer service scenario: first response\n\nThumbtack lead:\nStandard cleaning, 2 bed", 210);
historySession("(mock weekly review instructions)", "{}", 200); // a kind that stays on Managed Agents: ignored

function emit(id: string, ev: Obj) {
  events.get(id)!.push(ev);
  for (const res of streams.get(id) ?? []) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
}
function json(res: http.ServerResponse, code: number, body: unknown) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }

// ----- direct Messages API with a simulated prompt cache -----
const cache = new Map<string, number>(); // system text -> expiry
const tokens = (s: string) => Math.max(1, Math.round(s.length / 4));

http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const u = new URL(req.url!, "http://x"), p = u.pathname;
    const auth = req.headers["x-api-key"] ? "x-api-key" : req.headers.authorization ? "bearer" : "";
    if (!auth) return json(res, 401, { error: "no key" });
    log.authHeaders.add(auth);
    if (req.method === "GET" && p === "/__log") return json(res, 200, { ...log, authHeaders: [...log.authHeaders] });
    if (req.method === "GET" && p === `/v1/agents/${AGENT_ID}`) return json(res, 200, { type: "agent", id: AGENT_ID, version: 1, archived_at: null, name: "mock-agent",
      model: { id: "claude-opus-5-5", effort: "low" }, system: "saved", multiagent: null, tools: [], mcp_servers: [], skills: [] });
    if (req.method !== "GET" && p.startsWith("/v1/agents")) { log.agentWrites++; return json(res, 400, {}); }
    if (req.method === "GET" && p === `/v1/environments/${ENV_ID}`) return json(res, 200, { type: "environment", id: ENV_ID, archived_at: null, config: { type: "cloud" } });
    if (req.method === "GET" && p === "/v1/sessions") {
      const all = [...sessions.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const start = Number(u.searchParams.get("page") || 0), limit = Number(u.searchParams.get("limit") || 100);
      return json(res, 200, { data: all.slice(start, start + limit).map(({ agent, ...s }) => ({ ...s, agent: { id: agent.id, version: agent.version } })),
        next_page: start + limit < all.length ? String(start + limit) : null });
    }
    let m: RegExpMatchArray | null;
    if (req.method === "GET" && (m = p.match(/^\/v1\/sessions\/([^/]+)$/))) return json(res, 200, sessions.get(m[1]));
    if (req.method === "GET" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events$/))) return json(res, 200, { data: events.get(m[1]) ?? [], next_page: null });
    if (req.method === "GET" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events\/stream$/))) {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
      streams.set(m[1], [...(streams.get(m[1]) ?? []), res]); return;
    }
    if (req.method === "POST" && p === "/v1/sessions") {
      const b = JSON.parse(body), id = `sesn_${++seq}`; log.sessionsCreated++;
      sessions.set(id, { type: "session", id, status: "idle", created_at: iso(Date.now()), archived_at: null, budget: null, resources: [], vault_ids: [],
        environment_id: b.environment_id, agent: { type: "agent", id: b.agent.id, version: b.agent.version, multiagent: null, model: b.agent.model,
          system: b.agent.system, tools: b.agent.tools, mcp_servers: [], skills: [] } });
      events.set(id, []); return json(res, 200, sessions.get(id));
    }
    if (req.method === "POST" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events$/))) {
      const id = m[1], ev = JSON.parse(body).events[0], t = Date.now(), evId = `ev${++seq}`;
      json(res, 200, { data: [{ id: evId, ...ev }] });
      const session = sessions.get(id)!, system = session.agent.system as string, user = ev.content[0].text as string;
      const key = `managed:${system}:${user}`, n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n);
      setTimeout(() => {
        emit(id, { id: evId, type: "user.message", content: ev.content, processed_at: iso(t) });
        emit(id, { id: `ev${++seq}`, type: "session.status_running", processed_at: iso(t + 5) });
        emit(id, { id: `ev${++seq}`, type: "span.model_request_start", processed_at: iso(t + 6) });
        emit(id, { id: `ev${++seq}`, type: "span.model_request_end", processed_at: iso(t + 30),
          model_usage: { input_tokens: tokens(user) + 800, output_tokens: 120, cache_read_input_tokens: tokens(system), cache_creation_input_tokens: 0 } });
        emit(id, { id: `ev${++seq}`, type: "agent.message", content: [{ type: "text", text: output(system, user, "managed", n) }], processed_at: iso(t + 35) });
        emit(id, { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, processed_at: iso(t + 40) });
      }, 20);
      return;
    }
    if (req.method === "POST" && p === "/v1/messages") {
      const b = JSON.parse(body);
      if (b.model === "claude-opus-5-5") {
        log.judges++;
        const side = (k: number) => ({ accuracy: 9 - k, task: 9, truthful: 10, format_ok: true, critical_errors: [], notes: "mock" });
        return json(res, 200, { id: `msg_j${++seq}`, type: "message", role: "assistant", model: b.model, stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ output_a: side(0), output_b: side(1), meaningful_difference: false, difference_summary: "mock" }) }],
          usage: { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 3000 } });
      }
      const system = b.system?.[0]?.text ?? "", ttl = b.system?.[0]?.cache_control?.ttl ?? "5m", user = b.messages[0].content as string;
      log.direct.push({ model: b.model, effort: b.output_config?.effort, ttl, max_tokens: b.max_tokens, tools: b.tools ?? null, thinking: b.thinking ?? null });
      const key = `direct:${system}:${user}`, n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n);
      const hit = (cache.get(system) ?? 0) > Date.now(), size = tokens(system);
      if (!hit) cache.set(system, Date.now() + (ttl === "1h" ? 3600_000 : Number(process.env.MOCK_5M_MS ?? 300_000)));
      return json(res, 200, { id: `msg_${++seq}`, type: "message", role: "assistant", model: b.model, stop_reason: "end_turn", stop_sequence: null, stop_details: null,
        content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: output(system, user, "direct", n) }],
        usage: { input_tokens: tokens(user), output_tokens: 110, cache_read_input_tokens: hit ? size : 0, cache_creation_input_tokens: hit ? 0 : size,
          cache_creation: { ephemeral_5m_input_tokens: !hit && ttl === "5m" ? size : 0, ephemeral_1h_input_tokens: !hit && ttl === "1h" ? size : 0 } } });
    }
    json(res, 404, { error: `mock: ${req.method} ${p}` });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock on ${port}`));
