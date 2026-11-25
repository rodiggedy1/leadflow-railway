/**
 * ONE-TIME EVALUATION (not an app feature): blind A/B test of Claude Sonnet 5.5 against Claude Opus 5.5 on the
 * automatic customer-SMS replies. Run on the owner's Mac from the LeadFlow folder:
 *   pnpm exec tsx docs/claude/staging/eval/sonnet-vs-opus.ts --limit 2     (smoke test)
 *   pnpm exec tsx docs/claude/staging/eval/sonnet-vs-opus.ts               (full run, 40 messages)
 *
 * How the model is kept the only variable:
 *  - It reads the last 40 automatic SMS-reply sessions that production actually ran on the saved agent (Opus),
 *    with their exact instructions, exact customer-message payload, Opus's original output and measured usage.
 *  - It sends the byte-identical instructions + payload to the same saved agent/version/environment as a new
 *    session with a session-level model override to Sonnet (same effort/settings as the original session).
 *  - Both outputs go through the production validation code; Sonnet gets production's single retry on failure.
 * Read-only for everything that exists: the saved agent and past sessions are only read. Nothing is sent to
 * customers and no task is created. Only api.anthropic.com is contacted. Each new session has a $1 hard cap.
 * (The overall $14 stop was removed with the owner's explicit authorization to complete all 40 messages.)
 * Output (stays on this Mac; contains real customer conversations): ~/leadflow-eval/report.html, results.json
 */
import { createHash, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";

// ---------- settings ----------
const ORIGIN = process.env.EVAL_ANTHROPIC_ORIGIN ?? "https://api.anthropic.com"; // tests point this at a local fake server
const OUT_DIR = process.env.EVAL_OUT_DIR ?? path.join(os.homedir(), "leadflow-eval");
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); const n = i > 0 ? Number(process.argv[i + 1]) : 40; return Number.isInteger(n) && n > 0 && n <= 40 ? n : 40; })();
const SESSION_CAP_CENTS = "100", MAX_SESSIONS_SCANNED = 5000; // no overall spend stop (owner authorized all 40); $1 cap per session stays
const SMS_PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===";
const SONNET = "claude-sonnet-5-5", JUDGE_MODEL = "claude-opus-5-5";
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = { // $ per million tokens (published)
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
const RUNTIME_PER_HOUR = 0.08, SESSION_TIMEOUT_MS = 240_000;

// ---------- only Anthropic may be contacted ----------
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin !== new URL(ORIGIN).origin) throw new Error(`EVAL_BLOCKED_HOST ${url.host}`);
  return realFetch(input, init);
}) as typeof fetch;

// ---------- hidden prompt ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const writeOut = (rl as any)._writeToOutput?.bind(rl);
(rl as any)._writeToOutput = (s: string) => { if (!muted && writeOut) writeOut(s); };
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string, secret = false): Promise<string> {
  process.stdout.write(question); muted = secret;
  const { value } = await lines.next(); muted = false;
  if (secret) process.stdout.write("\n");
  return String(value ?? "").trim();
}

// ---------- types ----------
interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number }
interface Call { sessionId: string; ok: boolean; valid: boolean; ms: number; usage: Usage; cost: number; rawOutput: string | null; error?: string }
interface Output { replyText: string; task: unknown; bookingQuote: unknown; quotePresentationLanguage: unknown }
interface ArmResult { model: string; settings: unknown; ok: boolean; error?: string; ms: number; calls: Call[]; cost: number; output?: Output }
interface JudgeSide { intent: number; action: number; factual: number; compliance: number; quality: number;
  task_decision_correct: boolean; critical_errors: { category: string; explanation: string }[]; notes: string }
interface CaseResult {
  id: string; createdAt: string; customerName: string | null; inboundText: string;
  conversation: { role: string; content: string; ts: number | null }[];
  arms: { opus: ArmResult; sonnet: ArmResult }; aIs: "opus" | "sonnet";
  judge?: { a: JudgeSide; b: JudgeSide; meaningful_difference: boolean; difference_summary: string; cost: number; error?: string };
}
interface Store { startedAt: string; agent: { id: string; version: number }; cases: CaseResult[]; judgeCost: number; stoppedForBudget: boolean; skipped: string[];
  /** The exact messages of this test (ids, newest first), fixed so a resume never drifts to newer messages. */ dataset?: string[] }

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function cost(model: string, u: Usage, ms: number): number {
  const p = PRICES[model]; if (!p) return 0;
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6 + ms / 3.6e6 * RUNTIME_PER_HOUR;
}
const modelId = (m: any): string => typeof m === "string" ? m : String(m?.id ?? "");

// ---------- Anthropic API ----------
let KEY = "";
let AGENT = { id: "", version: 0, env: "", versionHeader: "", beta: "" };
async function api(method: string, p: string, body?: unknown, beta = true): Promise<any> {
  const r = await fetch(`${ORIGIN}${p}`, { method, headers: { "x-api-key": KEY, "anthropic-version": AGENT.versionHeader,
    ...(beta ? { "anthropic-beta": AGENT.beta } : {}), accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`HTTP_${r.status} ${p.split("?")[0].split("/").slice(0, 3).join("/")} ${t.slice(0, 240)}`); }
  return r.json();
}
async function* paged(p: string): AsyncGenerator<any> {
  let page: string | null = null;
  do {
    const r = await api("GET", `${p}${p.includes("?") ? "&" : "?"}limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`);
    for (const item of r.data ?? []) yield item;
    page = r.next_page ?? null;
  } while (page);
}

/** Summarise one session's events: input text, final output, usage, timing, outcome. */
interface SessionFacts { userText: string | null; output: string | null; usage: Usage; ms: number; error?: string }
function facts(events: any[]): SessionFacts {
  const usage = emptyUsage(); const texts: string[] = []; let userText: string | null = null, start: number | null = null;
  let end: number | null = null, error: string | undefined = "NO_IDLE_EVENT", runStart: number | null = null, runMs = 0;
  for (const ev of events) {
    const at = ev.processed_at ? Date.parse(ev.processed_at) : NaN;
    if (ev.type === "user.message" && userText === null) {
      userText = (ev.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""); if (!isNaN(at)) start = at;
    } else if (ev.type === "agent.message") texts.push((ev.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
    else if (ev.type === "span.model_request_end") {
      const m = ev.model_usage ?? {}; usage.requests++;
      usage.input += m.input_tokens ?? 0; usage.output += m.output_tokens ?? 0;
      usage.cacheRead += m.cache_read_input_tokens ?? 0; usage.cacheWrite += m.cache_creation_input_tokens ?? 0;
    } else if (ev.type === "session.status_running" && !isNaN(at)) runStart = at;
    else if (ev.type === "session.status_idle") {
      if (!isNaN(at)) { end = at; if (runStart !== null) { runMs += at - runStart; runStart = null; } }
      const stop = ev.stop_reason?.type;
      error = stop === "end_turn" && ev.stop_details == null ? undefined
        : `INCOMPLETE_TURN ${stop ?? "?"} ${ev.stop_details?.type ?? ""} ${ev.stop_details?.category ?? ""}`.trim();
    } else if (["session.error", "session.status_terminated"].includes(ev.type)) error = `SESSION_${ev.type}`;
  }
  const ms = start !== null && end !== null ? end - start : runMs;
  return { userText, output: error ? null : (texts.at(-1) ?? null), usage, ms, ...(error ? { error } : {}) };
}
async function sessionEvents(id: string): Promise<any[]> { const all: any[] = []; for await (const ev of paged(`/v1/sessions/${id}/events`)) all.push(ev); return all; }

async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = frame.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).replace(/^ /, "")).join("\n");
        if (data) { try { yield JSON.parse(data); } catch { /* not JSON */ } }
      }
      if (done) return;
    }
  } finally { void reader.cancel().catch(() => undefined); }
}

/** New Sonnet session: the request production sends, with the session-level model override and a $1 cap. */
async function runSonnet(system: string, user: string, model: unknown): Promise<{ sessionId: string; facts: SessionFacts; wallMs: number }> {
  const t0 = Date.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), SESSION_TIMEOUT_MS);
  let sessionId = "";
  try {
    const session = await api("POST", "/v1/sessions", {
      agent: { type: "agent_with_overrides", id: AGENT.id, version: AGENT.version, tools: [], mcp_servers: [], skills: [], system, model },
      environment_id: AGENT.env, budget: { type: "limit", max_list_cost: { amount: SESSION_CAP_CENTS, currency: "USD" } } });
    sessionId = session.id;
    if (modelId(session?.agent?.model) !== SONNET) throw new Error(`MODEL_MISMATCH ${modelId(session?.agent?.model)}`);
    const stream = await fetch(`${ORIGIN}/v1/sessions/${sessionId}/events/stream`, { signal: ctl.signal,
      headers: { "x-api-key": KEY, "anthropic-version": AGENT.versionHeader, "anthropic-beta": AGENT.beta, accept: "text/event-stream" } });
    if (!stream.ok || !stream.body) throw new Error(`HTTP_${stream.status} stream`);
    await api("POST", `/v1/sessions/${sessionId}/events`, { events: [{ type: "user.message", content: [{ type: "text", text: user }] }] });
    const seen: any[] = [];
    for await (const ev of sse(stream.body)) {
      seen.push(ev);
      if (["session.status_idle", "session.error", "session.status_terminated"].includes(ev.type)) break;
    }
    clearTimeout(timer); ctl.abort();
    // Same measurement source as the Opus sessions: the session's own recorded events.
    let f = facts(await sessionEvents(sessionId));
    for (let i = 0; i < 3 && f.error === "NO_IDLE_EVENT"; i++) { await new Promise(r => setTimeout(r, 1000)); f = facts(await sessionEvents(sessionId)); }
    return { sessionId, facts: f, wallMs: Date.now() - t0 };
  } catch (e: any) {
    const f = sessionId ? facts(await sessionEvents(sessionId).catch(() => [])) : { userText: null, output: null, usage: emptyUsage(), ms: 0 };
    return { sessionId, facts: { ...f, output: null, error: ctl.signal.aborted ? "TIMEOUT" : String(e?.message ?? e).slice(0, 240) }, wallMs: Date.now() - t0 };
  } finally { clearTimeout(timer); ctl.abort(); }
}

// ---------- production validation code (unchanged) ----------
async function loadProduction() {
  return {
    client: await import("../../../../server/instinct/claudeAgentClient"),
    gen: await import("../../../../server/instinct/claudeCustomerSmsGeneration"),
    quoteGen: await import("../../../../server/instinct/smsBookingQuoteGeneration"),
    quote: await import("../../../../server/instinct/smsBookingQuote"),
    tasks: await import("../../../../shared/claudeCustomerTasks"),
  };
}
type Prod = Awaited<ReturnType<typeof loadProduction>>;
/** The checks production applies to a model output, in the same order (generateSmsBookingQuoteReply). */
function validate(prod: Prod, text: string | null, payload: any): { ok: boolean; output?: Output; error?: string } {
  if (text === null) return { ok: false, error: "NO_OUTPUT" };
  try {
    // Same shape as extendedReplySchema in smsBookingQuoteGeneration.ts (not exported there).
    const schema = prod.tasks.customerReplyPlanSchema.extend({
      bookingQuote: prod.quote.smsBookingQuoteUpdateSchema.nullable().optional().default(null),
      quoteTextTemplate: z.string().min(1).nullable().optional().default(null),
      quotePresentationLanguage: z.enum(["en", "es"]).nullable().optional().default(null),
    }).strict();
    const parsed: any = schema.parse(JSON.parse(text));
    if (parsed.bookingQuote === null && parsed.quoteTextTemplate !== null) throw new Error("SMS_QUOTE_TEMPLATE_WITHOUT_UPDATE");
    const binding = payload.context.binding;
    const plan = prod.gen.validateClaudeCustomerReplyPlan(JSON.stringify({ replyText: parsed.replyText, task: parsed.task }),
      { incomingMessage: payload.incomingMessage, context: payload.context, protectedIds: [binding.providerMessageId, binding.receivingPhoneNumberId] });
    if (parsed.bookingQuote !== null) {
      const previous = payload.context.smsBookingQuote?.state ? prod.quote.smsBookingQuoteStateSchema.parse(payload.context.smsBookingQuote.state) : null;
      const originalConversation = (payload.context.originalConversation ?? []).map(({ turnIndex, ...turn }: any) => turn);
      prod.quote.advanceSmsBookingQuote(previous, parsed.bookingQuote, { binding, originalConversation, nowMs: binding.receivedAt });
      prod.quote.assertSmsBookingQuoteModelText(plan.replyText);
      if (/[{}]/.test(plan.replyText)) throw new Error("SMS_QUOTE_TEMPLATE_IN_REPLY");
    }
    return { ok: true, output: { replyText: plan.replyText, task: plan.task ?? null, bookingQuote: parsed.bookingQuote, quotePresentationLanguage: parsed.quotePresentationLanguage } };
  } catch (e: any) { return { ok: false, error: `VALIDATION: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

// ---------- blind judge ----------
const CRITICAL = ["wrong_price_or_date", "false_claim_of_action", "wrong_customer_details", "missed_staff_request",
  "invented_staff_request", "contradicts_knowledge_base", "inappropriate_content", "other"];
const SIDE_SCHEMA = { type: "object", additionalProperties: false,
  required: ["intent", "action", "factual", "compliance", "quality", "task_decision_correct", "critical_errors", "notes"],
  properties: { intent: { type: "integer" }, action: { type: "integer" }, factual: { type: "integer" }, compliance: { type: "integer" },
    quality: { type: "integer" }, task_decision_correct: { type: "boolean" }, notes: { type: "string" },
    critical_errors: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "explanation"],
      properties: { category: { type: "string", enum: CRITICAL }, explanation: { type: "string" } } } } } };
const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["reply_a", "reply_b", "meaningful_difference", "difference_summary"],
  properties: { reply_a: SIDE_SCHEMA, reply_b: SIDE_SCHEMA, meaningful_difference: { type: "boolean" }, difference_summary: { type: "string" } } };
function judgeSystem(prod: Prod, kb: string): string {
  return `You are an impartial evaluator of automated SMS replies for Maids in Black, a residential cleaning company.
For one customer message you see the conversation so far, the current inbound message, and two candidate outputs, "Reply A" and "Reply B", produced independently by two different AI systems from the identical input. Their identities are hidden and randomized. NEITHER reply is a reference answer: judge each only against the conversation, the knowledge base and the business rules below. Do not prefer a reply for being longer, more formal or more similar to the other.

Each candidate output is the full structured output: replyText (the SMS), task (proposed work for human staff, or null), bookingQuote (proposed booking-quote update with evidence, or null). Prices, the booking link and the final quote summary are NOT written by the model: the server adds them from a valid bookingQuote. A reply must never write its own prices or links.

Score each reply 0-10 (10 = flawless, 7 = acceptable with minor issues, 4 = noticeable problems, 0 = wrong or unusable) on:
- intent: understood what the customer actually wants right now.
- action: the right staff-task decision (a task when concrete staff work was requested, none otherwise; correct items, evidence quoted from the current message) and the right booking-quote decision and fields.
- factual: dates, times, service details and facts consistent with the conversation and knowledge base; nothing invented.
- compliance: follows the business rules (no false claims that something was booked or done, no own prices or links, style and safety rules).
- quality: warm, natural, concise, appropriate SMS.
Set task_decision_correct to true only if the decision to create or not create a staff task, and its items, are right.
List critical_errors for serious problems only: wrong price or date, claiming an action or booking was done, wrong customer details, missing a clear staff request, inventing a staff request, contradicting the knowledge base, inappropriate content. A candidate shown as "NO USABLE RESPONSE" scores 0 on everything.
Set meaningful_difference to true only if the two replies would lead to materially different customer outcomes or staff work.

=== KNOWLEDGE BASE ===
${kb}

=== BUSINESS RULES THE REPLIES WERE GIVEN ===
${prod.quoteGen.SMS_BOOKING_QUOTE_GENERATION_INSTRUCTIONS}

${prod.gen.CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS}`;
}
const candidate = (a: ArmResult) => a.ok && a.output ? JSON.stringify(a.output, null, 1) : `NO USABLE RESPONSE (${a.error ?? "failed"})`;
const isCustomer = (role: string) => role === "user" || role === "customer";
const et = (ts: number) => new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" });
async function judgeCase(system: string, c: CaseResult): Promise<NonNullable<CaseResult["judge"]>> {
  const A = c.arms[c.aIs], B = c.arms[c.aIs === "opus" ? "sonnet" : "opus"];
  const convo = c.conversation.map((t, i) => `[${i}] ${isCustomer(t.role) ? "CUSTOMER" : "BUSINESS"}${t.ts ? ` (${et(t.ts)} ET)` : ""}: ${t.content}`).join("\n");
  const user = `Customer: ${c.customerName ?? "unknown"}\nConversation so far (oldest first; the last CUSTOMER line is the current message):\n${convo}\n\nCURRENT INBOUND MESSAGE: ${c.inboundText}\n\n=== Reply A ===\n${candidate(A)}\n\n=== Reply B ===\n${candidate(B)}`;
  const r = await api("POST", "/v1/messages", { model: JUDGE_MODEL, max_tokens: 8000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } } }, false);
  const u: Usage = { input: r.usage?.input_tokens ?? 0, output: r.usage?.output_tokens ?? 0,
    cacheRead: r.usage?.cache_read_input_tokens ?? 0, cacheWrite: r.usage?.cache_creation_input_tokens ?? 0, requests: 1 };
  const spent = cost(JUDGE_MODEL, u, 0);
  if (r.stop_reason !== "end_turn") return { a: zeroSide(), b: zeroSide(), meaningful_difference: false, difference_summary: "", cost: spent, error: `JUDGE_${r.stop_reason}` };
  const j = JSON.parse((r.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
  return { a: clampSide(j.reply_a), b: clampSide(j.reply_b), meaningful_difference: !!j.meaningful_difference, difference_summary: String(j.difference_summary ?? ""), cost: spent };
}
const zeroSide = (): JudgeSide => ({ intent: 0, action: 0, factual: 0, compliance: 0, quality: 0, task_decision_correct: false, critical_errors: [], notes: "" });
function clampSide(s: any): JudgeSide {
  const c = (n: any) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
  return { intent: c(s?.intent), action: c(s?.action), factual: c(s?.factual), compliance: c(s?.compliance), quality: c(s?.quality),
    task_decision_correct: !!s?.task_decision_correct, critical_errors: Array.isArray(s?.critical_errors) ? s.critical_errors : [], notes: String(s?.notes ?? "") };
}

// ---------- scoring (identities used only after judging) ----------
const sideFor = (c: CaseResult, arm: "opus" | "sonnet"): JudgeSide | null => !c.judge || c.judge.error ? null : c.aIs === arm ? c.judge.a : c.judge.b;
const structured = (a: ArmResult) => !a.ok ? 0 : a.calls.length === 1 ? 10 : 5;
function weighted(c: CaseResult, arm: "opus" | "sonnet"): number {
  const a = c.arms[arm]; const s = sideFor(c, arm) ?? zeroSide();
  if (!a.ok) return 0;
  return 0.25 * s.intent + 0.25 * s.action + 0.20 * s.factual + 0.15 * s.compliance + 0.10 * structured(a) + 0.05 * s.quality;
}
function criticals(c: CaseResult, arm: "opus" | "sonnet") {
  const list = [...(sideFor(c, arm)?.critical_errors ?? [])];
  if (!c.arms[arm].ok) list.unshift({ category: "no_usable_reply", explanation: c.arms[arm].error ?? "failed" });
  return list;
}
function disagreement(c: CaseResult): string[] {
  const o = c.arms.opus, s = c.arms.sonnet, why: string[] = [];
  if (o.ok !== s.ok) why.push("one model produced no usable reply");
  if (o.ok && s.ok) {
    if ((o.output!.task === null) !== (s.output!.task === null)) why.push("different staff-task decision");
    const qa = (o.output!.bookingQuote as any)?.action ?? null, qb = (s.output!.bookingQuote as any)?.action ?? null;
    if (qa !== qb) why.push(`different booking action (Opus ${qa ?? "none"}, Sonnet ${qb ?? "none"})`);
  }
  if (Math.abs(weighted(c, "opus") - weighted(c, "sonnet")) >= 1.5) why.push("score gap of 1.5 or more");
  if (criticals(c, "opus").length || criticals(c, "sonnet").length) why.push("critical error");
  if (c.judge?.meaningful_difference) why.push("judge: materially different outcome");
  if (c.judge?.error) why.push(`judge could not score (${c.judge.error})`);
  return why;
}
function summary(store: Store, arm: "opus" | "sonnet") {
  const cs = store.cases, n = cs.length, A = cs.map(c => c.arms[arm]);
  const ok = A.filter(a => a.ok).length, total = A.reduce((s, a) => s + a.cost, 0), times = A.filter(a => a.ok).map(a => a.ms);
  const usage = A.flatMap(a => a.calls).reduce((u, k) => ({ input: u.input + k.usage.input, output: u.output + k.usage.output,
    cacheRead: u.cacheRead + k.usage.cacheRead, cacheWrite: u.cacheWrite + k.usage.cacheWrite, requests: u.requests + k.usage.requests }), emptyUsage());
  return { n, ok, total, usage, first: A.filter(a => a.ok && a.calls.length === 1).length, retried: A.filter(a => a.calls.length > 1).length,
    quality: n ? cs.reduce((s, c) => s + weighted(c, arm), 0) / n : 0, criticalCases: cs.filter(c => criticals(c, arm).length).length,
    taskCorrect: cs.filter(c => c.arms[arm].ok && sideFor(c, arm)?.task_decision_correct).length,
    avgMs: times.length ? times.reduce((s, x) => s + x, 0) / times.length : 0, perSuccess: ok ? total / ok : 0 };
}

// ---------- report ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const money = (x: number) => `$${x.toFixed(x < 1 ? 4 : 2)}`;
function explain(error?: string): string {
  const e = String(error ?? "");
  if (/refusal/i.test(e)) return "The model declined to answer (safety refusal), so no reply was produced.";
  if (/budget_reached/i.test(e)) return "The session reached its $1 safety cap before finishing.";
  if (/INCOMPLETE_TURN/.test(e)) return "The model stopped without a normal finished answer.";
  if (/NO_OUTPUT|NO_IDLE_EVENT|STREAM_ENDED/.test(e)) return "No answer text came back from the session.";
  if (/TIMEOUT/.test(e)) return "No answer within 4 minutes.";
  if (/MODEL_MISMATCH/.test(e)) return "The session did not run on the expected model; the attempt was discarded.";
  if (/^HTTP_/.test(e)) return "Anthropic's API returned an error for this request.";
  if (/JSON|Unexpected token|is not valid JSON/i.test(e)) return "The answer was not the strict JSON format the app requires, so production would reject it.";
  if (/EVIDENCE|QUOTE/i.test(e)) return "A quoted piece of evidence did not match the customer's actual words exactly, so production would reject it.";
  if (/PRICE|URL|TEMPLATE/i.test(e)) return "The reply wrote its own price, link or template text, which the production checks forbid.";
  if (/^VALIDATION/.test(e)) return "The answer failed one of production's checks on the reply (shown in the technical reason).";
  return "See the technical reason.";
}
const label = (arm: "opus" | "sonnet") => arm === "opus" ? "Opus 5.5 (original production run)" : "Sonnet 5.5 (new run, same input)";
function armHtml(c: CaseResult, arm: "opus" | "sonnet"): string {
  const a = c.arms[arm], s = sideFor(c, arm), crit = criticals(c, arm);
  const out = a.ok && a.output ? `<div class="sms">${esc(a.output.replyText)}</div>
    <div class="small"><b>Staff task:</b> ${a.output.task ? `<pre>${esc(JSON.stringify(a.output.task, null, 1))}</pre>` : "none"}</div>
    <div class="small"><b>Booking-quote update:</b> ${a.output.bookingQuote ? `<pre>${esc(JSON.stringify(a.output.bookingQuote, null, 1))}</pre>` : "none"}</div>`
    : `<div class="fail">NO USABLE REPLY: ${esc(explain(a.error))}<br><span class="small">Technical reason: ${esc(a.error)}</span></div>`;
  const raw = a.calls.map((k, i) => `<details><summary>attempt ${i + 1}: ${k.valid ? "valid" : `failed: ${esc(explain(k.error))} (${esc(k.error ?? "invalid")})`} · ${(k.ms / 1000).toFixed(1)}s · ${money(k.cost)} · ${k.usage.input.toLocaleString()} in / ${k.usage.output.toLocaleString()} out</summary><pre>${esc(k.rawOutput ?? "")}</pre></details>`).join("");
  return `<td><h4>${label(arm)} <span class="small">(was Model ${c.aIs === arm ? "A" : "B"})</span> · score ${weighted(c, arm).toFixed(1)}</h4>${out}
    ${crit.length ? `<div class="crit">${crit.map(e => `⚠ ${esc(e.category)}: ${esc(e.explanation)}`).join("<br>")}</div>` : ""}
    ${s ? `<div class="small">intent ${s.intent} · action ${s.action} · factual ${s.factual} · compliance ${s.compliance} · structured ${structured(a)} · quality ${s.quality} · task decision ${s.task_decision_correct ? "correct" : "wrong"}<br><i>${esc(s.notes)}</i></div>` : ""}
    <div class="small">attempts ${a.calls.length} · ${(a.ms / 1000).toFixed(1)}s · ${money(a.cost)}</div>${raw}</td>`;
}
function caseHtml(c: CaseResult, i: number): string {
  const turn = (t: CaseResult["conversation"][number]) => `<div class="${isCustomer(t.role) ? "cust" : "biz"}"><b>${isCustomer(t.role) ? "Customer" : "Business"}</b>${t.ts ? ` <span class="small">${esc(et(t.ts))}</span>` : ""}: ${esc(t.content)}</div>`;
  const earlier = c.conversation.slice(0, -1), shown = earlier.slice(-6), why = disagreement(c);
  return `<section id="case-${i + 1}"><h3>Case ${i + 1} · ${esc(c.customerName ?? "customer")} · ${esc(c.createdAt)} ${why.length ? `<span class="tag">${esc(why.join("; "))}</span>` : ""}</h3>
    ${earlier.length > shown.length ? `<details><summary>Full conversation before this message (${earlier.length} messages)</summary>${earlier.map(turn).join("")}</details>` : ""}
    ${shown.map(turn).join("")}
    <div class="inbound"><b>Customer message being answered:</b> ${esc(c.inboundText)}</div>
    ${c.judge?.difference_summary ? `<div class="small"><b>Judge on the difference:</b> ${esc(c.judge.difference_summary)}</div>` : ""}
    <table class="side"><tr>${armHtml(c, "opus")}${armHtml(c, "sonnet")}</tr></table></section>`;
}
function report(store: Store): string {
  const o = summary(store, "opus"), s = summary(store, "sonnet"), n = store.cases.length;
  let w = 0, l = 0, t = 0;
  for (const c of store.cases) { const d = weighted(c, "sonnet") - weighted(c, "opus"); if (d >= 0.5) w++; else if (d <= -0.5) l++; else t++; }
  const savings = o.total ? (1 - s.total / o.total) * 100 : 0;
  const crit = store.cases.flatMap((c, i) => (["opus", "sonnet"] as const).flatMap(arm => criticals(c, arm).map(e =>
    `<tr><td><a href="#case-${i + 1}">Case ${i + 1}</a></td><td>${arm === "opus" ? "Opus" : "Sonnet"}</td><td>${esc(e.category)}</td><td>${esc(e.category === "no_usable_reply" ? `${explain(e.explanation)} (${e.explanation})` : e.explanation)}</td></tr>`)));
  const dis = store.cases.map((c, i) => ({ i, why: disagreement(c) })).filter(x => x.why.length);
  const row = (k: string, a: string, b: string) => `<tr><td>${k}</td><td>${a}</td><td>${b}</td></tr>`;
  const pct = (x: number) => n ? `${Math.round(x / n * 100)}%` : "-";
  const newSpend = s.total + store.judgeCost;
  const settings = (arm: "opus" | "sonnet") => esc(JSON.stringify(store.cases[0]?.arms[arm].settings ?? "-"));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sonnet vs Opus SMS test</title><style>
  body{font:14px/1.45 -apple-system,Segoe UI,sans-serif;margin:16px;color:#1d1d1f;background:#fff} table{border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
  .side{width:100%;table-layout:fixed} .sms{background:#eef6ff;border-radius:8px;padding:8px;white-space:pre-wrap} .cust,.biz{margin:2px 0} .biz{color:#555}
  .inbound{background:#fff6e0;padding:6px;margin:6px 0;border-radius:6px} .crit{color:#b00020;font-weight:600;margin:6px 0} .fail{color:#b00020;font-weight:600}
  .small{font-size:12px;color:#555} pre{white-space:pre-wrap;font-size:12px;margin:2px 0} .tag{font-size:12px;background:#ffe4e4;color:#900;padding:2px 6px;border-radius:4px}
  section{border-top:2px solid #ccc;margin-top:18px;padding-top:6px} h4{margin:2px 0 6px}
  @media (prefers-color-scheme: dark){body{background:#111;color:#eee}.sms{background:#1b2a3a}.inbound{background:#3a3020}td,th{border-color:#444}.small,.biz{color:#aaa}}
  </style></head><body>
  <h1>Sonnet 5.5 vs Opus 5.5: automatic customer SMS replies</h1>
  <p class="small">The last ${n} automatic SMS replies production ran on Opus. Sonnet received the byte-identical instructions and message payload through the same saved agent (session-level model override). Both outputs went through the production validation code; a failed output got production's single retry. The judge (Opus 5.5) scored randomized "Reply A / Reply B" without model names; identities were revealed only after scoring. The Opus column is the original production output, shown for comparison and not treated as correct. Opus settings ${settings("opus")}; Sonnet settings ${settings("sonnet")}. Started ${esc(store.startedAt)}.</p>
  <h2>Summary</h2><table><tr><th></th><th>Opus 5.5</th><th>Sonnet 5.5</th></tr>
  ${row("Overall quality score (0-10, weighted)", o.quality.toFixed(2), s.quality.toFixed(2))}
  ${row("Cases with a critical error", String(o.criticalCases), String(s.criticalCases))}
  ${row(`Successful responses (of ${n})`, String(o.ok), String(s.ok))}
  ${row("Correct task decisions", `${o.taskCorrect} of ${n}`, `${s.taskCorrect} of ${n}`)}
  ${row("First-attempt success rate", pct(o.first), pct(s.first))}
  ${row("Retry rate", pct(o.retried), pct(s.retried))}
  ${row("Average response time (successful, incl. retries)", `${(o.avgMs / 1000).toFixed(1)} s`, `${(s.avgMs / 1000).toFixed(1)} s`)}
  ${row("Total cost incl. retries", money(o.total), money(s.total))}
  ${row("Average cost per successful response", money(o.perSuccess), money(s.perSuccess))}
  ${row("Measured tokens: input / output", `${o.usage.input.toLocaleString()} / ${o.usage.output.toLocaleString()}`, `${s.usage.input.toLocaleString()} / ${s.usage.output.toLocaleString()}`)}
  ${row("Measured cache tokens: read / written", `${o.usage.cacheRead.toLocaleString()} / ${o.usage.cacheWrite.toLocaleString()}`, `${s.usage.cacheRead.toLocaleString()} / ${s.usage.cacheWrite.toLocaleString()}`)}
  </table>
  <p><b>Savings from switching to Sonnet: ${savings.toFixed(0)}%</b> (${money(o.total)} vs ${money(s.total)} for the same ${n} messages). <b>Sonnet wins ${w} · loses ${l} · ties ${t}</b> (a win = weighted score at least 0.5 higher).</p>
  <p class="small">Token counts and response times are <b>measured</b> (recorded by Anthropic in each session). Costs are <b>calculated</b>: measured tokens × published prices (Opus $4/$20, Sonnet $2/$10 per million input/output; cache reads $0.20/$0.10; cache writes at the 5-minute rate) plus session time at $0.08/hour. Anthropic's invoice is the only billed figure. New spend for this test: Sonnet ${money(s.total)} + judge ${money(store.judgeCost)} = ${money(newSpend)} (the Opus figures are from the original production runs and cost nothing new).</p>
  <h2>Critical errors (${crit.length})</h2>${crit.length ? `<table><tr><th>Case</th><th>Model</th><th>Type</th><th>Explanation</th></tr>${crit.join("")}</table>` : "<p>None.</p>"}
  <h2>Meaningful disagreements (${dis.length})</h2>${dis.length ? `<ul>${dis.map(x => `<li><a href="#case-${x.i + 1}">Case ${x.i + 1}</a>: ${esc(x.why.join("; "))}</li>`).join("")}</ul>` : "<p>None.</p>"}
  ${store.skipped.length ? `<p class="small">Skipped: ${esc(store.skipped.join("; "))}</p>` : ""}
  <h2>All messages, side by side</h2>${store.cases.map(caseHtml).join("")}</body></html>`;
}

// ---------- main ----------
async function main() {
  console.log("LeadFlow one-time test: Sonnet 5.5 vs Opus 5.5 on the automatic customer SMS replies.");
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(OUT_DIR, "results.json"), reportPath = path.join(OUT_DIR, "report.html");
  KEY = await ask("Paste the Anthropic API key created for this test (hidden), then press Enter: ", true);
  if (!KEY) throw new Error("STOP: no API key entered.");
  const prod = await loadProduction();
  AGENT = { id: prod.client.EXISTING_AGENT_ID, version: prod.client.EXISTING_AGENT_VERSION, env: prod.client.EXISTING_ENVIRONMENT_ID,
    versionHeader: prod.client.ANTHROPIC_VERSION, beta: prod.client.ANTHROPIC_BETA };
  const base = await api("GET", `/v1/agents/${AGENT.id}`); // read-only
  if (base.version !== AGENT.version || base.archived_at) throw new Error("STOP: the saved agent is not the version production uses.");
  console.log(`Saved agent read (not changed): model ${JSON.stringify(base.model)}.`);

  const store: Store = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, "utf8"))
    : { startedAt: new Date().toISOString(), agent: { id: AGENT.id, version: AGENT.version }, cases: [], judgeCost: 0, stoppedForBudget: false, skipped: [] };
  store.stoppedForBudget = false;
  const save = () => { fs.writeFileSync(resultsPath, JSON.stringify(store), { mode: 0o600 }); fs.writeFileSync(reportPath, report(store), { mode: 0o600 }); };
  const newSpend = () => store.cases.reduce((s, c) => s + c.arms.sonnet.cost, 0) + store.judgeCost;

  // 1. The last automatic SMS-reply sessions production ran on this agent (newest first), grouped by identical
  //    input: production's retry re-sends the same input in a new session, so a group = one customer message.
  console.log("Finding the most recent automatic SMS-reply sessions (read-only)...");
  type Group = { key: string; sessions: any[] };
  const groups = new Map<string, Group>(); let scanned = 0, extra = 0;
  const gid = (key: string) => key.slice(0, 16);
  // Resume without drift: use the saved list, or else only messages up to the newest one already evaluated.
  const wanted = store.dataset ? new Set(store.dataset) : null;
  const cutoff = !wanted && store.cases.length ? Math.max(...store.cases.map(c => Date.parse(c.createdAt))) : Infinity;
  const earliest = (g: Group) => Math.min(...g.sessions.map((x: any) => Date.parse(x.created_at)));
  const enough = () => wanted ? [...wanted].every(id => [...groups.keys()].some(k => gid(k) === id))
    : [...groups.values()].filter(g => earliest(g) <= cutoff).length >= LIMIT;
  for await (const s of paged("/v1/sessions?order=desc")) {
    if (++scanned > MAX_SESSIONS_SCANNED) break;
    const full = s?.agent?.system !== undefined ? s : await api("GET", `/v1/sessions/${s.id}`);
    if (full?.agent?.id !== AGENT.id || typeof full.agent.system !== "string" || !full.agent.system.startsWith(SMS_PREFIX)) continue;
    if (!["idle", "terminated"].includes(String(full.status))) continue;
    if (modelId(full.agent.model) !== "claude-opus-5-5") continue; // production runs only (not this test's Sonnet sessions)
    if (Date.parse(full.created_at) > cutoff + 15 * 60_000) continue; // newer than the original test's messages
    if (enough() && extra++ > 40) break;
    const events = await sessionEvents(full.id); const f = facts(events);
    if (f.userText === null) continue;
    const key = sha(`${full.agent.system}\u0000${f.userText}`);
    if (wanted ? !wanted.has(gid(key)) : !groups.has(key) && enough()) continue; // only the test's messages (and their retry attempts)
    const g = groups.get(key) ?? { key, sessions: [] }; g.sessions.push({ ...full, facts: f }); groups.set(key, g);
  }
  const chosen = wanted
    ? store.dataset!.map(id => [...groups.values()].find(g => gid(g.key) === id)).filter((g): g is Group => !!g)
    : [...groups.values()].filter(g => earliest(g) <= cutoff)
        .sort((a, b) => Math.max(...b.sessions.map((x: any) => Date.parse(x.created_at))) - Math.max(...a.sessions.map((x: any) => Date.parse(x.created_at))))
        .slice(0, LIMIT);
  if (!wanted && LIMIT === 40) { store.dataset = chosen.map(g => gid(g.key)); save(); }
  const missingDone = store.cases.filter(c => !chosen.some(g => gid(g.key) === c.id)).length;
  if (missingDone) console.log(`Note: ${missingDone} already-evaluated message(s) were not found again; they stay in the report.`);
  console.log(`Scanned ${scanned} sessions; found ${chosen.length} customer messages answered automatically.`);

  // 2. Run Sonnet on each, judge blind, save after every message.
  const kb = await (await import("../../../../server/madisonKnowledgeRetrieval")).retrieveKnowledge("");
  const judgeSys = judgeSystem(prod, String(kb));
  for (const g of chosen) {
    if (store.cases.some(c => c.id === gid(g.key))) continue; // already evaluated: kept as is
    const sessions = g.sessions.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const system: string = sessions[0].agent.system, user: string = sessions[0].facts.userText;
    let payload: any; try { payload = JSON.parse(user); } catch { store.skipped.push(`${g.key.slice(0, 8)} (payload not JSON)`); continue; }
    const opusModel = sessions[0].agent.model, opusId = modelId(opusModel);
    if (opusId !== "claude-opus-5-5") { store.skipped.push(`${g.key.slice(0, 8)} (ran on ${opusId})`); continue; }
    process.stdout.write(`Message ${store.cases.length + 1}/${chosen.length}: `);

    // Opus: the original production attempts (measured).
    const opusCalls: Call[] = sessions.map((s: any) => { const v = validate(prod, s.facts.output, payload);
      return { sessionId: s.id, ok: !s.facts.error, valid: v.ok, ms: s.facts.ms, usage: s.facts.usage, cost: cost(opusId, s.facts.usage, s.facts.ms),
        rawOutput: s.facts.output, ...(v.ok ? {} : { error: s.facts.error ?? v.error }) }; });
    const opusValid = validate(prod, sessions.at(-1).facts.output, payload);
    const opus: ArmResult = { model: opusId, settings: opusModel, ok: opusValid.ok, ...(opusValid.ok ? { output: opusValid.output } : { error: opusCalls.at(-1)!.error }),
      ms: opusCalls.reduce((s, k) => s + k.ms, 0), calls: opusCalls, cost: opusCalls.reduce((s, k) => s + k.cost, 0) };

    // Sonnet: same input, same settings except the model; production's single retry if the output fails validation.
    const sonnetModel: any = typeof opusModel === "string" ? { id: SONNET } : { ...opusModel, id: SONNET };
    if (sonnetModel.speed === "fast") delete sonnetModel.speed;
    if (!sonnetModel.effort) sonnetModel.effort = "medium"; // Opus 5.5's default when the agent sets none
    const sonnetCalls: Call[] = []; let sonnetOut: ReturnType<typeof validate> = { ok: false, error: "NOT_RUN" };
    for (let attempt = 0; attempt < 2 && !sonnetOut.ok; attempt++) {
      const r = await runSonnet(system, user, sonnetModel);
      sonnetOut = validate(prod, r.facts.output, payload);
      sonnetCalls.push({ sessionId: r.sessionId, ok: !r.facts.error, valid: sonnetOut.ok, ms: r.facts.ms || r.wallMs, usage: r.facts.usage,
        cost: cost(SONNET, r.facts.usage, r.facts.ms || r.wallMs), rawOutput: r.facts.output, ...(sonnetOut.ok ? {} : { error: r.facts.error ?? sonnetOut.error }) });
    }
    const sonnet: ArmResult = { model: SONNET, settings: sonnetModel, ok: sonnetOut.ok, ...(sonnetOut.ok ? { output: sonnetOut.output } : { error: sonnetCalls.at(-1)!.error }),
      ms: sonnetCalls.reduce((s, k) => s + k.ms, 0), calls: sonnetCalls, cost: sonnetCalls.reduce((s, k) => s + k.cost, 0) };

    const conv = (payload.context?.originalConversation ?? []).map((t: any) => ({ role: String(t.role), content: String(t.content), ts: typeof t.ts === "number" ? t.ts : null }));
    const c: CaseResult = { id: gid(g.key), createdAt: String(sessions[0].created_at), customerName: payload.context?.contact?.displayName ?? null,
      inboundText: String(payload.incomingMessage ?? ""), conversation: conv, arms: { opus, sonnet }, aIs: randomInt(2) === 0 ? "opus" : "sonnet" };
    process.stdout.write(`Opus ${opus.ok ? "valid" : "INVALID"}, Sonnet ${sonnet.ok ? "valid" : "INVALID"}${sonnet.calls.length > 1 ? " (after retry)" : ""}; judging... `);
    if (opus.ok || sonnet.ok) {
      try { c.judge = await judgeCase(judgeSys, c); store.judgeCost += c.judge.cost; }
      catch (e: any) { c.judge = { a: zeroSide(), b: zeroSide(), meaningful_difference: false, difference_summary: "", cost: 0, error: String(e?.message ?? e).slice(0, 160) }; }
    }
    store.cases.push(c); save();
    console.log(`done (new spend ${money(newSpend())})`);
  }
  save();
  const o = summary(store, "opus"), s = summary(store, "sonnet");
  const fmt = (x: ReturnType<typeof summary>) => `quality ${x.quality.toFixed(2)} | critical ${x.criticalCases} | valid ${x.ok}/${x.n} | task correct ${x.taskCorrect} | first-try ${x.first} | retried ${x.retried} | avg ${(x.avgMs / 1000).toFixed(1)}s | cost ${money(x.total)} | per success ${money(x.perSuccess)}`;
  let w = 0, l = 0, t = 0; for (const c of store.cases) { const d = weighted(c, "sonnet") - weighted(c, "opus"); if (d >= 0.5) w++; else if (d <= -0.5) l++; else t++; }
  console.log("\n===== SUMMARY (safe to paste: no customer details) =====");
  console.log(`Messages: ${store.cases.length} of ${store.dataset?.length ?? store.cases.length}`);
  console.log(`Opus 5.5:   ${fmt(o)}`);
  console.log(`Sonnet 5.5: ${fmt(s)}`);
  console.log(`Sonnet wins ${w} / loses ${l} / ties ${t} | meaningful disagreements ${store.cases.filter(c => disagreement(c).length).length}`);
  console.log(`Savings from Sonnet: ${o.total ? ((1 - s.total / o.total) * 100).toFixed(0) : "-"}% | new spend: Sonnet ${money(s.total)} + judge ${money(store.judgeCost)} = ${money(newSpend())}`);
  console.log(`Report: ${reportPath}`);
  rl.close(); process.exit(0);
}
main().catch(e => { console.error(`\n${String(e?.message ?? e)}`); rl.close(); process.exit(1); });
