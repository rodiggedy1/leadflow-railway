// TEST ONLY: a local fake of the Anthropic endpoints prompt-trim-compare.ts uses, with invented conversations.
// Usage: node mock-anthropic-prompt-trim.mjs <port>   Prints the fingerprint to pass as EVAL_CURRENT_PROMPT_SHA.
import http from "node:http";
import { createHash } from "node:crypto";
const port = Number(process.argv[2] || 8788);
const AGENT_ID = "agent_01Naiw8VvfB75yd2VWUtVP6v", PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===";
const CURRENT = `${PREFIX}\n(mock current production instructions)`, OLDER = `${PREFIX}\n(mock older instructions)`;
console.log(`CURRENT_SHA=${createHash("sha256").update(CURRENT).digest("hex")}`);
const now = Date.now(); let seq = 0;
const iso = ms => new Date(ms).toISOString();
const log = { sessions: [], systems: [], judges: 0, agentWrites: 0, budgets: [] };
const sonnet = { id: "claude-sonnet-5-5", effort: "low" };

function payload(i, inbound) {
  const ts = now - (100 - i) * 3600_000;
  const turns = [{ role: "assistant", content: "Hi! Thanks for contacting Maids in Black. How can we help?", ts: ts - 600_000 }, { role: "user", content: inbound, ts }];
  return { incomingMessage: inbound, context: {
    binding: { fromPhone: "+12025550101", customerName: `Test Customer ${i}` }, contact: { displayName: `Test Customer ${i}`, phone: "+12025550101" },
    originalConversation: turns.map((t, k) => ({ turnIndex: 40 + k, ...t })), earlierMessagesOmitted: 40, receivingPhoneNumber: "+12025550199", bookingContext: null,
    openStaffTasks: [], unavailableRecords: [], smsBookingQuote: { state: null, currentLocalDate: "2026-11-20", currentLocalTime: "10:00" } } };
}
const INBOUND = ["Do you bring your own supplies?", "Please move my cleaning to Friday", "I'd like a quote for a standard cleaning", "Thanks so much, see you then!"];
function reply(inbound, arm) {
  if (inbound.startsWith("Please move")) return { replyText: "Got it! We'll take care of moving your cleaning to Friday and confirm once it's updated.",
    task: { title: "Reschedule cleaning", items: [{ title: "Move the cleaning to Friday", evidenceQuote: "move my cleaning to Friday" }] }, bookingQuote: null, quotePresentationLanguage: null };
  if (inbound.startsWith("I'd like a quote")) return { replyText: "Happy to help! How many bedrooms and bathrooms?", task: null, quotePresentationLanguage: "en",
    bookingQuote: { action: "collect", intentEvidenceQuote: "a quote for a standard cleaning", fields: { serviceId: "standard" },
      evidence: { serviceId: { turnIndex: 41, quote: arm === "current" ? "an invented deep clean" : "standard cleaning" } } } };
  return { replyText: "You're welcome! We're happy to help.", task: null, bookingQuote: null, quotePresentationLanguage: null };
}

const sessions = new Map(), events = new Map();
function addSession({ system, created, userText, output }) {
  const id = `sesn_${++seq}`; sessions.set(id, { type: "session", id, status: "idle", created_at: iso(created), archived_at: null,
    agent: { type: "agent", id: AGENT_ID, version: 1, system, model: sonnet, tools: [], mcp_servers: [], skills: [] }, environment_id: "env_01U7m4FNwLv7iecyqyKfFFsW" });
  events.set(id, [
    { id: `ev${++seq}`, type: "user.message", content: [{ type: "text", text: userText }], processed_at: iso(created + 100) },
    { id: `ev${++seq}`, type: "session.status_running", processed_at: iso(created + 120) },
    { id: `ev${++seq}`, type: "span.model_request_end", model_usage: { input_tokens: 3000, output_tokens: 300, cache_read_input_tokens: 13000, cache_creation_input_tokens: 0 }, processed_at: iso(created + 4000) },
    { id: `ev${++seq}`, type: "agent.message", content: [{ type: "text", text: JSON.stringify(output) }], processed_at: iso(created + 4100) },
    { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, processed_at: iso(created + 4200) },
  ]);
}
// Production history: 4 messages with the current instructions (one answered twice by a production retry), 2 older-instruction ones, an email.
for (let i = 0; i < INBOUND.length; i++) {
  const userText = JSON.stringify(payload(i, INBOUND[i])), created = now - (100 - i) * 3600_000 + 1000;
  addSession({ system: CURRENT, created, userText, output: reply(INBOUND[i], "current") });
  if (i === 1) addSession({ system: CURRENT, created: created + 9000, userText, output: reply(INBOUND[i], "current") });
}
addSession({ system: OLDER, created: now - 200 * 3600_000, userText: JSON.stringify(payload(50, "older message")), output: {} });
addSession({ system: OLDER, created: now - 201 * 3600_000, userText: JSON.stringify(payload(51, "older message 2")), output: {} });
addSession({ system: "=== CURRENT CAPABILITY — HIGHEST PRIORITY ===\nemail", created: now - 50 * 3600_000, userText: "{}", output: {} });

const streams = new Map(), attempts = new Map();
function emit(id, ev) { events.get(id).push(ev); for (const res of streams.get(id) ?? []) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); }
function json(res, code, body) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }

http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (!req.headers["x-api-key"]) return json(res, 401, { error: "no key" });
    if (req.method === "GET" && p === "/__log") return json(res, 200, log);
    if (req.method === "GET" && p === `/v1/agents/${AGENT_ID}`) return json(res, 200, { type: "agent", id: AGENT_ID, version: 1, archived_at: null, model: { id: "claude-opus-5-5", effort: "low" } });
    if (req.method !== "GET" && p.startsWith("/v1/agents")) { log.agentWrites++; return json(res, 400, {}); }
    if (req.method === "GET" && p === "/v1/sessions") {
      const all = [...sessions.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const start = Number(u.searchParams.get("page") || 0), limit = Number(u.searchParams.get("limit") || 100);
      return json(res, 200, { data: all.slice(start, start + limit).map(({ agent, ...s }) => ({ ...s, agent: { id: agent.id, version: agent.version } })),
        next_page: start + limit < all.length ? String(start + limit) : null });
    }
    let m;
    if (req.method === "GET" && (m = p.match(/^\/v1\/sessions\/([^/]+)$/))) return json(res, 200, sessions.get(m[1]));
    if (req.method === "GET" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events$/))) return json(res, 200, { data: events.get(m[1]) ?? [], next_page: null });
    if (req.method === "GET" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events\/stream$/))) {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); (streams.get(m[1]) ?? streams.set(m[1], []).get(m[1])).push(res); return;
    }
    if (req.method === "POST" && p === "/v1/sessions") {
      const b = JSON.parse(body), id = `sesn_${++seq}`;
      log.sessions.push(id); log.systems.push(b.agent.system === CURRENT ? "current" : b.agent.system.startsWith(PREFIX) ? "trimmed" : "other"); log.budgets.push(b.budget);
      sessions.set(id, { type: "session", id, status: "idle", created_at: iso(Date.now()), agent: { ...b.agent, type: "agent" }, budget: b.budget });
      events.set(id, []); return json(res, 200, sessions.get(id));
    }
    if (req.method === "POST" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events$/))) {
      const id = m[1], ev = JSON.parse(body).events[0], t = Date.now();
      emit(id, { id: `ev${++seq}`, type: "user.message", content: ev.content, processed_at: iso(t) });
      json(res, 200, { data: [{ id: `ev${seq}`, ...ev }] });
      const arm = sessions.get(id).agent.system === CURRENT ? "current" : "trimmed", inbound = JSON.parse(ev.content[0].text).incomingMessage;
      const key = `${arm}:${inbound}`, n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n);
      setTimeout(() => {
        emit(id, { id: `ev${++seq}`, type: "session.status_running", processed_at: iso(t + 10) });
        emit(id, { id: `ev${++seq}`, type: "span.model_request_end", processed_at: iso(t + 30),
          model_usage: { input_tokens: 3000, output_tokens: 320, cache_read_input_tokens: arm === "current" ? 13600 : 11600, cache_creation_input_tokens: 0 } });
        // Trimmed arm: invalid on the first try for the reschedule message (tests the retry).
        const text = arm === "trimmed" && inbound.startsWith("Please move") && n === 1 ? "not json" : JSON.stringify(reply(inbound, arm));
        emit(id, { id: `ev${++seq}`, type: "agent.message", content: [{ type: "text", text }], processed_at: iso(t + 35) });
        emit(id, { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, processed_at: iso(t + 40) });
      }, 20);
      return;
    }
    if (req.method === "POST" && p === "/v1/messages") {
      log.judges++;
      const side = k => ({ service: 8 + k, task: 9, booking: 9, truthful: 10, task_decision_correct: true, critical_errors: [], notes: "mock" });
      const out = { reply_a: side(0), reply_b: side(1), meaningful_difference: false, difference_summary: "mock summary" };
      return json(res, 200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }],
        usage: { input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } });
    }
    json(res, 404, { error: `mock: ${req.method} ${p}` });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock on ${port}`));
