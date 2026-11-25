// TEST ONLY: a local fake of the Anthropic endpoints the evaluation uses, with invented conversations.
// Usage: node mock-anthropic.mjs <port>   (MOCK_BIG_USAGE=1 makes every Sonnet session expensive, to test the budget stop)
import http from "node:http";
const port = Number(process.argv[2] || 8787);
const AGENT_ID = "agent_01Naiw8VvfB75yd2VWUtVP6v", PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===";
const SMS_SYSTEM = `${PREFIX}\n(production instructions would be here)`;
const now = Date.now(); let seq = 0;
const iso = ms => new Date(ms).toISOString();
const log = { posts: [], modelOverrides: [], agentWrites: 0, budgets: [] };

function payload(i, inbound) {
  const ts = now - (100 - i) * 3600_000, id = `ACmsg${i}`;
  const history = [
    { role: "assistant", content: "Hi! Thanks for contacting Maids in Black. How can we help?", ts: ts - 600_000 },
    { role: "user", content: inbound, ts, opMsgId: id, receivingPhoneNumberId: "PNline1" },
  ];
  return { incomingMessage: inbound, context: {
    binding: { sessionId: 100 + i, providerMessageId: id, fromPhone: "+12025550101", receivingPhoneNumberId: "PNline1", receivingPhoneNumber: "+12025550199",
      inboundText: inbound, createdAt: ts, receivedAt: ts, customerName: `Test Customer ${i}`, historyHash: "x", historyContextHash: "y" },
    contact: { sessionId: String(100 + i), phone: "+12025550101", rawPhone: "+12025550101", displayName: `Test Customer ${i}` },
    originalConversation: history.map((t, turnIndex) => ({ ...t, turnIndex })),
    receivingPhoneNumberId: "PNline1", receivingPhoneNumber: "+12025550199", bookingContext: null,
    smsBookingQuote: { state: null, currentLocalDate: "2026-11-20", currentLocalTime: "10:00" }, knowledgeBase: "KB" } };
}
const INBOUND = ["Do you bring your own supplies?", "Please move my cleaning to Friday", "Are you open on Saturdays?",
  "Can I add inside the fridge next time?", "What areas do you serve?", "Thanks so much, see you then!"];
const reply = (inbound, variant) => inbound.startsWith("Please move")
  ? { replyText: `Got it${variant ? " 😊" : ""}! We'll take care of moving your cleaning to Friday and confirm once it's updated.`,
      task: { title: "Reschedule cleaning", items: [{ title: "Move the cleaning to Friday", evidenceQuote: "move my cleaning to Friday" }] }, bookingQuote: null, quotePresentationLanguage: null }
  : { replyText: `Hi there${variant ? " ✨" : ""}! Great question. Our team will be happy to help with that.`, task: null, bookingQuote: null, quotePresentationLanguage: null };

// Past production sessions (newest first): 6 SMS messages, one with a retry (first attempt invalid), plus noise.
const sessions = new Map(), events = new Map();
function addSession({ system, model, created, userText, output, usage, invalid }) {
  const id = `sesn_${++seq}`; sessions.set(id, { type: "session", id, status: "idle", created_at: iso(created), archived_at: null, budget: null,
    agent: { type: "agent", id: AGENT_ID, version: 1, system, model, tools: [], mcp_servers: [], skills: [], multiagent: null }, environment_id: "env_01U7m4FNwLv7iecyqyKfFFsW" });
  const t = created;
  events.set(id, [
    { id: `ev${++seq}`, type: "user.message", content: [{ type: "text", text: userText }], processed_at: iso(t + 100) },
    { id: `ev${++seq}`, type: "session.status_running", processed_at: iso(t + 120) },
    { id: `ev${++seq}`, type: "span.model_request_end", is_error: false, model_usage: usage, processed_at: iso(t + 5000) },
    { id: `ev${++seq}`, type: "agent.message", content: [{ type: "text", text: invalid ? "Sorry, here is the reply: not JSON" : JSON.stringify(output) }], processed_at: iso(t + 5100) },
    { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, processed_at: iso(t + 5200) },
  ]);
}
const opus = { id: "claude-opus-5-5", effort: "medium" };
for (let i = 0; i < INBOUND.length; i++) {
  const userText = JSON.stringify(payload(i, INBOUND[i])), created = now - (100 - i) * 3600_000 + 1000;
  if (i === 2) addSession({ system: SMS_SYSTEM, model: opus, created, userText, invalid: true, usage: { input_tokens: 18000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  addSession({ system: SMS_SYSTEM, model: opus, created: created + (i === 2 ? 9000 : 0), userText, output: reply(INBOUND[i], false),
    usage: { input_tokens: 19000 + i * 100, output_tokens: 350, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  addSession({ system: "=== CURRENT CAPABILITY — HIGHEST PRIORITY ===\nemail", model: opus, created: created + 500, userText: "{}", output: {}, usage: { input_tokens: 9000, output_tokens: 100 } });
}

const streams = new Map();
function emit(id, ev) { events.get(id).push(ev); for (const res of streams.get(id) ?? []) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); }
function json(res, code, body) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
const sonnetAttempts = new Map();

http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const u = new URL(req.url, "http://x"), p = u.pathname;
    if (!req.headers["x-api-key"]) return json(res, 401, { error: "no key" });
    if (req.method === "GET" && p === "/__log") return json(res, 200, log);
    if (req.method === "GET" && p === `/v1/agents/${AGENT_ID}`) return json(res, 200, { type: "agent", id: AGENT_ID, version: 1, archived_at: null, model: opus, system: "saved", multiagent: null });
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
      const b = JSON.parse(body); log.posts.push("session"); log.modelOverrides.push(b.agent.model); log.budgets.push(b.budget);
      const id = `sesn_${++seq}`;
      sessions.set(id, { type: "session", id, status: "idle", created_at: iso(Date.now()), agent: { ...b.agent, type: "agent", model: b.agent.model ?? opus }, budget: b.budget });
      events.set(id, []); return json(res, 200, sessions.get(id));
    }
    if (req.method === "POST" && (m = p.match(/^\/v1\/sessions\/([^/]+)\/events$/))) {
      const id = m[1], ev = JSON.parse(body).events[0]; const t = Date.now();
      emit(id, { id: `ev${++seq}`, type: "user.message", content: ev.content, processed_at: iso(t) });
      json(res, 200, { data: [{ id: `ev${seq}`, ...ev }] });
      const userText = ev.content[0].text, pl = JSON.parse(userText), key = pl.incomingMessage;
      const n = (sonnetAttempts.get(key) ?? 0) + 1; sonnetAttempts.set(key, n);
      const big = process.env.MOCK_BIG_USAGE === "1";
      setTimeout(() => {
        emit(id, { id: `ev${++seq}`, type: "session.status_running", processed_at: iso(t + 10) });
        emit(id, { id: `ev${++seq}`, type: "span.model_request_end", is_error: false, processed_at: iso(t + 30),
          model_usage: { input_tokens: big ? 1_500_000 : 19500, output_tokens: 320, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
        // Sonnet behaviour: invalid on the first try for "Are you open on Saturdays?" (tests the retry), refusal for "What areas".
        if (key.startsWith("What areas")) {
          emit(id, { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, stop_details: { type: "refusal", category: "general_harms" }, processed_at: iso(t + 40) });
        } else {
          const text = key.startsWith("Are you open") && n === 1 ? "not json" : JSON.stringify(reply(key, true));
          emit(id, { id: `ev${++seq}`, type: "agent.message", content: [{ type: "text", text }], processed_at: iso(t + 35) });
          emit(id, { id: `ev${++seq}`, type: "session.status_idle", stop_reason: { type: "end_turn" }, processed_at: iso(t + 40) });
        }
      }, 20);
      return;
    }
    if (req.method === "POST" && p === "/v1/messages") {
      const b = JSON.parse(body); log.posts.push("judge");
      const side = k => ({ intent: 8 + k, action: 8, factual: 9, compliance: 8, quality: 7 + k, task_decision_correct: true,
        critical_errors: k ? [] : [{ category: "other", explanation: "mock critical note" }], notes: "mock" });
      const out = { reply_a: side(0), reply_b: side(1), meaningful_difference: b.messages[0].content.includes("move my cleaning"), difference_summary: "mock summary" };
      return json(res, 200, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }],
        usage: { input_tokens: 3000, output_tokens: 600, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } });
    }
    json(res, 404, { error: `mock: ${req.method} ${p}` });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock on ${port}`));
