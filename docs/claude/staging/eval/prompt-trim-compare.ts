/**
 * ONE-TIME COMPARISON (not an app feature): the current fixed instructions vs the trimmed ones (branch
 * claude/prompt-trim) on the automatic customer-SMS replies. Same model (Sonnet 5.5, production's settings),
 * same customer-message input; only the fixed instructions differ. Run on the owner's Mac from the LeadFlow folder:
 *   pnpm exec tsx docs/claude/staging/eval/prompt-trim-compare.ts --limit 2     (smoke test)
 *   pnpm exec tsx docs/claude/staging/eval/prompt-trim-compare.ts               (full run, 20 messages)
 *
 *  - Reads the last 20 automatic SMS-reply sessions production ran with the CURRENT instructions (recognised by
 *    their exact fingerprint), read-only: exact instructions and exact customer-message payload.
 *  - Runs each message twice as new sessions on the same saved agent: "current" with the recorded instructions,
 *    "trimmed" with the instructions this branch's code builds. Both on the model settings production used.
 *  - Both outputs go through the production checks; each arm gets production's single retry on failure.
 *  - An Opus 5.5 judge scores randomized "Reply A / Reply B" without knowing which is which, on practical
 *    accuracy only: customer-service accuracy, task creation, booking accuracy, no false claims of completed
 *    actions. Wording differences alone are not penalized.
 * Read-only for everything that exists. Nothing is sent to customers and no task is created. Only api.anthropic.com
 * is contacted. Each new session has a $1 hard cap; the whole run stops at $5 of new spend (expected $1.50-3).
 * Output (stays on this Mac; contains real customer conversations): ~/leadflow-prompt-trim/report.html, results.json
 */
import { createHash, randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";

// ---------- settings ----------
const ORIGIN = process.env.EVAL_ANTHROPIC_ORIGIN ?? "https://api.anthropic.com"; // tests point this at a local fake server
const OUT_DIR = process.env.EVAL_OUT_DIR ?? path.join(os.homedir(), "leadflow-prompt-trim");
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); const n = i > 0 ? Number(process.argv[i + 1]) : 20; return Number.isInteger(n) && n > 0 && n <= 20 ? n : 20; })();
const SESSION_CAP_CENTS = "100", TOTAL_STOP_DOLLARS = 5, MAX_SESSIONS_SCANNED = 5000;
/** Fingerprint of the SMS instructions production sends today (main ffb0d30). Only those sessions are used. */
const CURRENT_PROMPT_SHA = process.env.EVAL_CURRENT_PROMPT_SHA ?? "81e3218bfb6d77f76c9b5bb12f4fdf776c78300fb4fd1ffec0ec7f25404a8fb1";
const SMS_PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===";
const JUDGE_MODEL = "claude-opus-5-5";
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = { // $ per million tokens (published)
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
const RUNTIME_PER_HOUR = 0.08, SESSION_TIMEOUT_MS = 240_000;
type Arm = "current" | "trimmed";
const ARMS: Arm[] = ["current", "trimmed"];

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
interface Call { sessionId: string; valid: boolean; ms: number; usage: Usage; cost: number; rawOutput: string | null; error?: string }
interface Output { replyText: string; task: unknown; bookingQuote: unknown; quotePresentationLanguage: unknown }
interface ArmResult { ok: boolean; error?: string; ms: number; calls: Call[]; cost: number; output?: Output }
interface JudgeSide { service: number; task: number; booking: number; truthful: number; task_decision_correct: boolean;
  critical_errors: { category: string; explanation: string }[]; notes: string }
interface CaseResult {
  id: string; createdAt: string; customerName: string | null; inboundText: string;
  conversation: { role: string; content: string; ts: number | null }[];
  arms: Record<Arm, ArmResult>; aIs: Arm;
  judge?: { a: JudgeSide; b: JudgeSide; meaningful_difference: boolean; difference_summary: string; cost: number; error?: string };
}
interface Store { startedAt: string; model: unknown; cases: CaseResult[]; judgeCost: number; stoppedForBudget: boolean; skipped: string[];
  /** Sessions this test created (never treated as production messages). */ ownSessions: string[];
  /** The exact messages of this test, fixed so a resume never drifts. */ dataset?: string[];
  promptSizes?: { current: number; trimmed: number } }

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

/** A new session exactly as production sends it (session-level system + model override), with a $1 cap. */
async function runSession(system: string, user: string, model: unknown, own: string[]): Promise<{ sessionId: string; facts: SessionFacts; wallMs: number }> {
  const t0 = Date.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), SESSION_TIMEOUT_MS);
  let sessionId = "";
  try {
    const session = await api("POST", "/v1/sessions", {
      agent: { type: "agent_with_overrides", id: AGENT.id, version: AGENT.version, tools: [], mcp_servers: [], skills: [], system, model },
      environment_id: AGENT.env, budget: { type: "limit", max_list_cost: { amount: SESSION_CAP_CENTS, currency: "USD" } } });
    sessionId = session.id; own.push(sessionId);
    if (modelId(session?.agent?.model) !== modelId(model)) throw new Error(`MODEL_MISMATCH ${modelId(session?.agent?.model)}`);
    const stream = await fetch(`${ORIGIN}/v1/sessions/${sessionId}/events/stream`, { signal: ctl.signal,
      headers: { "x-api-key": KEY, "anthropic-version": AGENT.versionHeader, "anthropic-beta": AGENT.beta, accept: "text/event-stream" } });
    if (!stream.ok || !stream.body) throw new Error(`HTTP_${stream.status} stream`);
    await api("POST", `/v1/sessions/${sessionId}/events`, { events: [{ type: "user.message", content: [{ type: "text", text: user }] }] });
    for await (const ev of sse(stream.body)) {
      if (["session.status_idle", "session.error", "session.status_terminated"].includes(ev.type)) break;
    }
    clearTimeout(timer); ctl.abort();
    let f = facts(await sessionEvents(sessionId));
    for (let i = 0; i < 3 && f.error === "NO_IDLE_EVENT"; i++) { await new Promise(r => setTimeout(r, 1000)); f = facts(await sessionEvents(sessionId)); }
    return { sessionId, facts: f, wallMs: Date.now() - t0 };
  } catch (e: any) {
    const f = sessionId ? facts(await sessionEvents(sessionId).catch(() => [])) : { userText: null, output: null, usage: emptyUsage(), ms: 0 };
    return { sessionId, facts: { ...f, output: null, error: ctl.signal.aborted ? "TIMEOUT" : String(e?.message ?? e).slice(0, 240) }, wallMs: Date.now() - t0 };
  } finally { clearTimeout(timer); ctl.abort(); }
}

// ---------- production code (unchanged) ----------
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
/** The trimmed SMS instructions, built by this branch's real generator (a fake runner captures them; nothing is sent). */
async function trimmedInstructions(prod: Prod): Promise<string> {
  let system = "";
  const binding = { sessionId: 1, providerMessageId: "m", fromPhone: "+12025550123", receivingPhoneNumberId: "PN", receivingPhoneNumber: "+12025550999",
    inboundText: "Hi", createdAt: 1, receivedAt: 2, customerName: null, historyHash: "x" };
  await prod.quoteGen.createSmsBookingQuoteReplyGenerator({ smsBookingQuote: { readState: async () => null },
    runner: async (o: any) => { system = o.systemPrompt; return { finalSmsText: JSON.stringify({ replyText: "Hi!", task: null, bookingQuote: null }) }; } })(
    { incomingMessage: "Hi", context: { binding, originalConversation: [{ role: "user", content: "Hi" }], contact: {}, bookingContext: null }, protectedIds: [] }).catch(() => undefined);
  if (!system.startsWith(SMS_PREFIX)) throw new Error("STOP: could not build the trimmed instructions.");
  return system;
}
/** The checks production applies to a model output, in the same order. Claude's input no longer carries the
 * internal IDs, so the identity fields come from the saved quote state (identity checks are app-internal). */
function validate(prod: Prod, text: string | null, payload: any, receivedAt: number): { ok: boolean; output?: Output; error?: string } {
  if (text === null) return { ok: false, error: "NO_OUTPUT" };
  try {
    const schema = prod.tasks.customerReplyPlanSchema.extend({
      bookingQuote: prod.quote.smsBookingQuoteUpdateSchema.nullable().optional().default(null),
      quoteTextTemplate: z.string().min(1).nullable().optional().default(null),
      quotePresentationLanguage: z.enum(["en", "es"]).nullable().optional().default(null),
    }).strict();
    const parsed: any = schema.parse(JSON.parse(text));
    if (parsed.bookingQuote === null && parsed.quoteTextTemplate !== null) throw new Error("SMS_QUOTE_TEMPLATE_WITHOUT_UPDATE");
    const ctx = payload.context ?? {}, state = ctx.smsBookingQuote?.state ?? null;
    const binding = { sessionId: state?.sessionId ?? 1, providerMessageId: "eval", receivingPhoneNumberId: state?.receivingPhoneNumberId ?? "eval-line",
      receivingPhoneNumber: ctx.receivingPhoneNumber ?? null, createdAt: receivedAt, receivedAt, historyHash: "eval", ...(ctx.binding ?? {}),
      fromPhone: ctx.binding?.fromPhone ?? state?.customerPhone, customerName: ctx.binding?.customerName ?? null, inboundText: payload.incomingMessage };
    const plan = prod.gen.validateClaudeCustomerReplyPlan(JSON.stringify({ replyText: parsed.replyText, task: parsed.task }),
      { incomingMessage: payload.incomingMessage, context: ctx, protectedIds: [] });
    if (parsed.bookingQuote !== null) {
      const previous = state ? prod.quote.smsBookingQuoteStateSchema.parse(state) : null;
      const turns: any[] = [];
      (ctx.originalConversation ?? []).forEach(({ turnIndex, ...turn }: any, i: number) => { turns[Number.isInteger(turnIndex) ? turnIndex : i] = { ...turn }; });
      // The app ties the current message to its provider ID, which Claude's input no longer carries: restore that link.
      const current = turns.filter(turn => turn && ["user", "customer"].includes(String(turn.role))).at(-1);
      if (current && binding.providerMessageId === "eval") current.opMsgId = "eval";
      prod.quote.advanceSmsBookingQuote(previous, parsed.bookingQuote, { binding: binding as any, originalConversation: turns, nowMs: receivedAt });
      prod.quote.assertSmsBookingQuoteModelText(plan.replyText);
      if (/[{}]/.test(plan.replyText)) throw new Error("SMS_QUOTE_TEMPLATE_IN_REPLY");
    }
    return { ok: true, output: { replyText: plan.replyText, task: plan.task ?? null, bookingQuote: parsed.bookingQuote, quotePresentationLanguage: parsed.quotePresentationLanguage } };
  } catch (e: any) { return { ok: false, error: `VALIDATION: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

// ---------- blind judge: practical accuracy only ----------
const CRITICAL = ["false_claim_of_completed_action", "wrong_booking_or_date", "wrong_price", "wrong_customer_details", "missed_staff_request",
  "invented_staff_request", "wrong_quote_fields", "contradicts_knowledge_base", "inappropriate_content", "other"];
const SIDE_SCHEMA = { type: "object", additionalProperties: false,
  required: ["service", "task", "booking", "truthful", "task_decision_correct", "critical_errors", "notes"],
  properties: { service: { type: "integer" }, task: { type: "integer" }, booking: { type: "integer" }, truthful: { type: "integer" },
    task_decision_correct: { type: "boolean" }, notes: { type: "string" },
    critical_errors: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "explanation"],
      properties: { category: { type: "string", enum: CRITICAL }, explanation: { type: "string" } } } } } };
const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["reply_a", "reply_b", "meaningful_difference", "difference_summary"],
  properties: { reply_a: SIDE_SCHEMA, reply_b: SIDE_SCHEMA, meaningful_difference: { type: "boolean" }, difference_summary: { type: "string" } } };
function judgeSystem(rules: string): string {
  return `You are an impartial evaluator of automated SMS replies for Maids in Black, a residential cleaning company.
For one customer message you see the conversation so far, the current inbound message, and two candidate outputs, "Reply A" and "Reply B", produced independently from the identical input. Their origin is hidden and randomized. NEITHER is a reference answer: judge each only against the conversation, the knowledge base and the business rules below.

JUDGE PRACTICAL OUTCOMES ONLY. Do NOT reward or penalize wording, tone, length, emoji or style differences. Two replies that say the same thing in different words are equal.

Each candidate output is the full structured output: replyText (the SMS), task (proposed work for human staff, or null), bookingQuote (proposed booking-quote update with evidence, or null). Prices, the booking link and the final quote summary are NOT written by the model: the server adds them from a valid bookingQuote. A reply must never write its own prices or links.

Score each reply 0-10 (10 = fully correct, 7 = acceptable with a minor practical issue, 4 = a real problem, 0 = wrong or unusable) on:
- service: answers the customer's actual question or request correctly, with accurate information from the knowledge base and conversation.
- task: correct staff-task decision (a task when the current message asks for concrete staff work, none otherwise), with the right items and evidence quoted from the current message.
- booking: correct booking handling: the right bookingQuote decision and fields for a new quote, no wrong dates/times/details, and correct reading of any saved booking information. 10 if no booking handling was needed and none was done.
- truthful: no false claim that an action was completed (booked, rescheduled, cancelled, refunded, notified, scheduled), no promised availability or outcome, no own prices or links.
Set task_decision_correct to true only if the decision to create or not create a staff task, and its items, are right.
List critical_errors only for serious practical problems. A candidate shown as "NO USABLE RESPONSE" scores 0 on everything.
Set meaningful_difference to true only if the two replies would lead to materially different customer outcomes or staff work.

=== BUSINESS RULES AND KNOWLEDGE THE REPLIES WERE GIVEN (current full version) ===
${rules}`;
}
const candidate = (a: ArmResult) => a.ok && a.output ? JSON.stringify(a.output, null, 1) : `NO USABLE RESPONSE (${a.error ?? "failed"})`;
const isCustomer = (role: string) => role === "user" || role === "customer";
const et = (ts: number) => new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" });
async function judgeCase(system: string, c: CaseResult, context: unknown): Promise<NonNullable<CaseResult["judge"]>> {
  const A = c.arms[c.aIs], B = c.arms[c.aIs === "current" ? "trimmed" : "current"];
  const convo = c.conversation.map((t, i) => `[${i}] ${isCustomer(t.role) ? "CUSTOMER" : "BUSINESS"}${t.ts ? ` (${et(t.ts)} ET)` : ""}: ${t.content}`).join("\n");
  const user = `Customer: ${c.customerName ?? "unknown"}\nSaved context given to both replies (booking records, open tasks, quote state):\n${JSON.stringify(context).slice(0, 6000)}\n\nConversation shown to both (oldest first; the last CUSTOMER line is the current message):\n${convo}\n\nCURRENT INBOUND MESSAGE: ${c.inboundText}\n\n=== Reply A ===\n${candidate(A)}\n\n=== Reply B ===\n${candidate(B)}`;
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
const zeroSide = (): JudgeSide => ({ service: 0, task: 0, booking: 0, truthful: 0, task_decision_correct: false, critical_errors: [], notes: "" });
function clampSide(s: any): JudgeSide {
  const c = (n: any) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
  return { service: c(s?.service), task: c(s?.task), booking: c(s?.booking), truthful: c(s?.truthful),
    task_decision_correct: !!s?.task_decision_correct, critical_errors: Array.isArray(s?.critical_errors) ? s.critical_errors : [], notes: String(s?.notes ?? "") };
}

// ---------- scoring (identities used only after judging) ----------
const sideFor = (c: CaseResult, arm: Arm): JudgeSide | null => !c.judge || c.judge.error ? null : c.aIs === arm ? c.judge.a : c.judge.b;
function score(c: CaseResult, arm: Arm): number {
  const s = sideFor(c, arm) ?? zeroSide();
  return c.arms[arm].ok ? 0.3 * s.service + 0.3 * s.task + 0.2 * s.booking + 0.2 * s.truthful : 0;
}
function criticals(c: CaseResult, arm: Arm) {
  const list = [...(sideFor(c, arm)?.critical_errors ?? [])];
  if (!c.arms[arm].ok) list.unshift({ category: "no_usable_reply", explanation: c.arms[arm].error ?? "failed" });
  return list;
}
function disagreement(c: CaseResult): string[] {
  const a = c.arms.current, b = c.arms.trimmed, why: string[] = [];
  if (a.ok !== b.ok) why.push("one version produced no usable reply");
  if (a.ok && b.ok) {
    if ((a.output!.task === null) !== (b.output!.task === null)) why.push("different staff-task decision");
    const qa = (a.output!.bookingQuote as any)?.action ?? null, qb = (b.output!.bookingQuote as any)?.action ?? null;
    if (qa !== qb) why.push(`different booking action (current ${qa ?? "none"}, trimmed ${qb ?? "none"})`);
  }
  if (Math.abs(score(c, "current") - score(c, "trimmed")) >= 1.5) why.push("score gap of 1.5 or more");
  if (criticals(c, "current").length || criticals(c, "trimmed").length) why.push("critical error");
  if (c.judge?.meaningful_difference) why.push("judge: materially different outcome");
  if (c.judge?.error) why.push(`judge could not score (${c.judge.error})`);
  return why;
}
function summary(store: Store, arm: Arm) {
  const cs = store.cases, n = cs.length, A = cs.map(c => c.arms[arm]);
  const usage = A.flatMap(a => a.calls).reduce((u, k) => ({ input: u.input + k.usage.input, output: u.output + k.usage.output,
    cacheRead: u.cacheRead + k.usage.cacheRead, cacheWrite: u.cacheWrite + k.usage.cacheWrite, requests: u.requests + k.usage.requests }), emptyUsage());
  const avg = (f: (s: JudgeSide) => number) => n ? cs.reduce((t, c) => t + (c.arms[arm].ok ? f(sideFor(c, arm) ?? zeroSide()) : 0), 0) / n : 0;
  return { n, ok: A.filter(a => a.ok).length, cost: A.reduce((s, a) => s + a.cost, 0), usage, retried: A.filter(a => a.calls.length > 1).length,
    score: n ? cs.reduce((s, c) => s + score(c, arm), 0) / n : 0, criticalCases: cs.filter(c => criticals(c, arm).length).length,
    falseClaims: cs.filter(c => (sideFor(c, arm)?.critical_errors ?? []).some(e => e.category === "false_claim_of_completed_action")).length,
    taskCorrect: cs.filter(c => c.arms[arm].ok && sideFor(c, arm)?.task_decision_correct).length,
    service: avg(s => s.service), task: avg(s => s.task), booking: avg(s => s.booking), truthful: avg(s => s.truthful) };
}

// ---------- report ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const money = (x: number) => `$${x.toFixed(x < 1 ? 4 : 2)}`;
const label = (arm: Arm) => arm === "current" ? "Current instructions" : "Trimmed instructions";
function armHtml(c: CaseResult, arm: Arm): string {
  const a = c.arms[arm], s = sideFor(c, arm), crit = criticals(c, arm);
  const out = a.ok && a.output ? `<div class="sms">${esc(a.output.replyText)}</div>
    <div class="small"><b>Staff task:</b> ${a.output.task ? `<pre>${esc(JSON.stringify(a.output.task, null, 1))}</pre>` : "none"}</div>
    <div class="small"><b>Booking-quote update:</b> ${a.output.bookingQuote ? `<pre>${esc(JSON.stringify(a.output.bookingQuote, null, 1))}</pre>` : "none"}</div>`
    : `<div class="fail">NO USABLE REPLY<br><span class="small">Technical reason: ${esc(a.error)}</span></div>`;
  const raw = a.calls.map((k, i) => `<details><summary>attempt ${i + 1}: ${k.valid ? "valid" : `failed (${esc(k.error ?? "invalid")})`} · ${(k.ms / 1000).toFixed(1)}s · ${money(k.cost)}</summary><pre>${esc(k.rawOutput ?? "")}</pre></details>`).join("");
  return `<td><h4>${label(arm)} <span class="small">(was Reply ${c.aIs === arm ? "A" : "B"})</span> · score ${score(c, arm).toFixed(1)}</h4>${out}
    ${crit.length ? `<div class="crit">${crit.map(e => `⚠ ${esc(e.category)}: ${esc(e.explanation)}`).join("<br>")}</div>` : ""}
    ${s ? `<div class="small">service ${s.service} · task ${s.task} · booking ${s.booking} · truthful ${s.truthful} · task decision ${s.task_decision_correct ? "correct" : "wrong"}<br><i>${esc(s.notes)}</i></div>` : ""}
    <div class="small">attempts ${a.calls.length} · ${money(a.cost)}</div>${raw}</td>`;
}
function caseHtml(c: CaseResult, i: number): string {
  const turn = (t: CaseResult["conversation"][number]) => `<div class="${isCustomer(t.role) ? "cust" : "biz"}"><b>${isCustomer(t.role) ? "Customer" : "Business"}</b>${t.ts ? ` <span class="small">${esc(et(t.ts))}</span>` : ""}: ${esc(t.content)}</div>`;
  const earlier = c.conversation.slice(0, -1), shown = earlier.slice(-6), why = disagreement(c);
  return `<section id="case-${i + 1}"><h3>Case ${i + 1} · ${esc(c.customerName ?? "customer")} · ${esc(c.createdAt)} ${why.length ? `<span class="tag">${esc(why.join("; "))}</span>` : ""}</h3>
    ${earlier.length > shown.length ? `<details><summary>Earlier messages (${earlier.length})</summary>${earlier.map(turn).join("")}</details>` : ""}
    ${shown.map(turn).join("")}
    <div class="inbound"><b>Customer message being answered:</b> ${esc(c.inboundText)}</div>
    ${c.judge?.difference_summary ? `<div class="small"><b>Judge on the difference:</b> ${esc(c.judge.difference_summary)}</div>` : ""}
    <table class="side"><tr>${armHtml(c, "current")}${armHtml(c, "trimmed")}</tr></table></section>`;
}
function report(store: Store): string {
  const a = summary(store, "current"), b = summary(store, "trimmed"), n = store.cases.length;
  let w = 0, l = 0, t = 0;
  for (const c of store.cases) { const d = score(c, "trimmed") - score(c, "current"); if (d >= 0.5) w++; else if (d <= -0.5) l++; else t++; }
  const crit = store.cases.flatMap((c, i) => ARMS.flatMap(arm => criticals(c, arm).map(e =>
    `<tr><td><a href="#case-${i + 1}">Case ${i + 1}</a></td><td>${label(arm)}</td><td>${esc(e.category)}</td><td>${esc(e.explanation)}</td></tr>`)));
  const dis = store.cases.map((c, i) => ({ i, why: disagreement(c) })).filter(x => x.why.length);
  const row = (k: string, x: string, y: string) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td></tr>`;
  const sizes = store.promptSizes;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Instruction trim comparison</title><style>
  body{font:14px/1.45 -apple-system,Segoe UI,sans-serif;margin:16px;color:#1d1d1f;background:#fff} table{border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
  .side{width:100%;table-layout:fixed} .sms{background:#eef6ff;border-radius:8px;padding:8px;white-space:pre-wrap} .cust,.biz{margin:2px 0} .biz{color:#555}
  .inbound{background:#fff6e0;padding:6px;margin:6px 0;border-radius:6px} .crit{color:#b00020;font-weight:600;margin:6px 0} .fail{color:#b00020;font-weight:600}
  .small{font-size:12px;color:#555} pre{white-space:pre-wrap;font-size:12px;margin:2px 0} .tag{font-size:12px;background:#ffe4e4;color:#900;padding:2px 6px;border-radius:4px}
  section{border-top:2px solid #ccc;margin-top:18px;padding-top:6px} h4{margin:2px 0 6px}
  @media (prefers-color-scheme: dark){body{background:#111;color:#eee}.sms{background:#1b2a3a}.inbound{background:#3a3020}td,th{border-color:#444}.small,.biz{color:#aaa}}
  </style></head><body>
  <h1>Current vs trimmed fixed instructions: automatic customer SMS replies</h1>
  <p class="small">The last ${n} automatic SMS replies production ran with the current instructions. Each message was answered twice, fresh, on the same model and settings (${esc(JSON.stringify(store.model))}): once with the current instructions${sizes ? ` (${sizes.current.toLocaleString()} characters)` : ""} and once with the trimmed ones${sizes ? ` (${sizes.trimmed.toLocaleString()} characters)` : ""}. Both went through the production checks with production's single retry. An Opus 5.5 judge scored randomized "Reply A / Reply B" on practical accuracy only (customer-service accuracy, task creation, booking accuracy, no false claims); wording differences were not penalized. Started ${esc(store.startedAt)}.</p>
  <h2>Summary</h2><table><tr><th></th><th>Current</th><th>Trimmed</th></tr>
  ${row("Overall practical score (0-10)", a.score.toFixed(2), b.score.toFixed(2))}
  ${row("Customer-service accuracy (avg)", a.service.toFixed(1), b.service.toFixed(1))}
  ${row("Task creation (avg)", a.task.toFixed(1), b.task.toFixed(1))}
  ${row("Booking accuracy (avg)", a.booking.toFixed(1), b.booking.toFixed(1))}
  ${row("No false claims (avg)", a.truthful.toFixed(1), b.truthful.toFixed(1))}
  ${row("Correct task decisions", `${a.taskCorrect} of ${n}`, `${b.taskCorrect} of ${n}`)}
  ${row("False claims of completed actions", String(a.falseClaims), String(b.falseClaims))}
  ${row("Cases with a critical error", String(a.criticalCases), String(b.criticalCases))}
  ${row(`Usable replies (of ${n})`, String(a.ok), String(b.ok))}
  ${row("Needed the retry", String(a.retried), String(b.retried))}
  ${row("Measured tokens in / out", `${a.usage.input.toLocaleString()} / ${a.usage.output.toLocaleString()}`, `${b.usage.input.toLocaleString()} / ${b.usage.output.toLocaleString()}`)}
  ${row("Measured cache tokens read / written", `${a.usage.cacheRead.toLocaleString()} / ${a.usage.cacheWrite.toLocaleString()}`, `${b.usage.cacheRead.toLocaleString()} / ${b.usage.cacheWrite.toLocaleString()}`)}
  </table>
  <p><b>Trimmed better ${w} · worse ${l} · tie ${t}</b> (a difference of at least 0.5 in the practical score).</p>
  <p class="small">Test spend: replies ${money(a.cost + b.cost)} + judge ${money(store.judgeCost)} = ${money(a.cost + b.cost + store.judgeCost)} (calculated from measured tokens × published prices).</p>
  <h2>Critical errors (${crit.length})</h2>${crit.length ? `<table><tr><th>Case</th><th>Version</th><th>Type</th><th>Explanation</th></tr>${crit.join("")}</table>` : "<p>None.</p>"}
  <h2>Meaningful disagreements (${dis.length})</h2>${dis.length ? `<ul>${dis.map(x => `<li><a href="#case-${x.i + 1}">Case ${x.i + 1}</a>: ${esc(x.why.join("; "))}</li>`).join("")}</ul>` : "<p>None.</p>"}
  ${store.skipped.length ? `<p class="small">Skipped: ${esc(store.skipped.join("; "))}</p>` : ""}${store.stoppedForBudget ? `<p class="crit">Stopped at the $${TOTAL_STOP_DOLLARS} spending stop.</p>` : ""}
  <h2>All messages, side by side</h2>${store.cases.map(caseHtml).join("")}</body></html>`;
}

// ---------- main ----------
async function main() {
  console.log("LeadFlow one-time comparison: current vs trimmed fixed instructions on automatic customer SMS replies.");
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(OUT_DIR, "results.json"), reportPath = path.join(OUT_DIR, "report.html");
  KEY = await ask("Paste the Anthropic API key created for this test (hidden), then press Enter: ", true);
  if (!KEY) throw new Error("STOP: no API key entered.");
  const prod = await loadProduction();
  AGENT = { id: prod.client.EXISTING_AGENT_ID, version: prod.client.EXISTING_AGENT_VERSION, env: prod.client.EXISTING_ENVIRONMENT_ID,
    versionHeader: prod.client.ANTHROPIC_VERSION, beta: prod.client.ANTHROPIC_BETA };
  const base = await api("GET", `/v1/agents/${AGENT.id}`); // read-only
  if (base.version !== AGENT.version || base.archived_at) throw new Error("STOP: the saved agent is not the version production uses.");
  const trimmed = await trimmedInstructions(prod);

  const store: Store = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, "utf8"))
    : { startedAt: new Date().toISOString(), model: null, cases: [], judgeCost: 0, stoppedForBudget: false, skipped: [], ownSessions: [] };
  store.stoppedForBudget = false;
  const save = () => { fs.writeFileSync(resultsPath, JSON.stringify(store), { mode: 0o600 }); fs.writeFileSync(reportPath, report(store), { mode: 0o600 }); };
  const spent = () => store.cases.reduce((s, c) => s + c.arms.current.cost + c.arms.trimmed.cost, 0) + store.judgeCost;

  // 1. The last production SMS replies sent with the current instructions (newest first), one per customer message.
  console.log("Finding recent automatic SMS replies sent with the current instructions (read-only)...");
  const startedAt = Date.parse(store.startedAt), own = new Set(store.ownSessions), wanted = store.dataset ? new Set(store.dataset) : null;
  const groups = new Map<string, { key: string; created: number; system: string; userText: string; model: unknown }>();
  let scanned = 0, otherInstructions = 0;
  for await (const s of paged("/v1/sessions?order=desc")) {
    if (++scanned > MAX_SESSIONS_SCANNED || (!wanted && groups.size >= LIMIT)) break;
    if (own.has(s.id) || Date.parse(s.created_at) >= startedAt) continue; // this test's sessions, or messages after it started
    const full = s?.agent?.system !== undefined ? s : await api("GET", `/v1/sessions/${s.id}`);
    if (full?.agent?.id !== AGENT.id || typeof full.agent.system !== "string" || !full.agent.system.startsWith(SMS_PREFIX)) continue;
    if (!["idle", "terminated"].includes(String(full.status))) continue;
    if (sha(full.agent.system) !== CURRENT_PROMPT_SHA) { otherInstructions++; continue; }
    const f = facts(await sessionEvents(full.id));
    if (f.userText === null) continue;
    const key = sha(f.userText).slice(0, 16);
    if (wanted && !wanted.has(key)) continue;
    if (!groups.has(key)) groups.set(key, { key, created: Date.parse(full.created_at), system: full.agent.system, userText: f.userText, model: full.agent.model });
    if (wanted && [...wanted].every(k => groups.has(k))) break;
  }
  const chosen = wanted ? store.dataset!.map(k => groups.get(k)).filter((g): g is NonNullable<typeof g> => !!g) : [...groups.values()].slice(0, LIMIT);
  store.promptSizes = { current: chosen[0]?.system.length ?? 0, trimmed: trimmed.length };
  if (!wanted && LIMIT === 20) { store.dataset = chosen.map(g => g.key); save(); } // a smoke run never fixes the set
  console.log(`Scanned ${scanned} sessions; found ${chosen.length} customer messages answered with the current instructions` +
    (otherInstructions ? ` (${otherInstructions} older replies used earlier instructions and were not used).` : "."));
  if (!chosen.length) throw new Error("STOP: no replies with the current instructions were found yet.");
  if (chosen.length < LIMIT) console.log(`Note: only ${chosen.length} were available; the comparison uses those.`);

  // 2. Answer each message with both instruction sets, judge blind, save after every message.
  const judgeSys = judgeSystem(chosen[0].system);
  for (const g of chosen) {
    if (store.cases.some(c => c.id === g.key)) continue;
    if (spent() >= TOTAL_STOP_DOLLARS) { store.stoppedForBudget = true; console.log(`Stopped: new spend reached $${TOTAL_STOP_DOLLARS}.`); break; }
    let payload: any; try { payload = JSON.parse(g.userText); } catch { store.skipped.push(`${g.key.slice(0, 8)} (payload not JSON)`); continue; }
    store.model = g.model;
    process.stdout.write(`Message ${store.cases.length + 1}/${chosen.length}: `);
    const arms = {} as Record<Arm, ArmResult>;
    for (const arm of ARMS) {
      const system = arm === "current" ? g.system : trimmed, calls: Call[] = [];
      let out: ReturnType<typeof validate> = { ok: false, error: "NOT_RUN" };
      for (let attempt = 0; attempt < 2 && !out.ok; attempt++) {
        const r = await runSession(system, g.userText, g.model, store.ownSessions);
        out = validate(prod, r.facts.output, payload, g.created);
        const ms = r.facts.ms || r.wallMs;
        calls.push({ sessionId: r.sessionId, valid: out.ok, ms, usage: r.facts.usage, cost: cost(modelId(g.model), r.facts.usage, ms),
          rawOutput: r.facts.output, ...(out.ok ? {} : { error: r.facts.error ?? out.error }) });
      }
      arms[arm] = { ok: out.ok, ...(out.ok ? { output: out.output } : { error: calls.at(-1)!.error }), ms: calls.reduce((s, k) => s + k.ms, 0),
        calls, cost: calls.reduce((s, k) => s + k.cost, 0) };
    }
    const ctx = payload.context ?? {};
    const conv = (ctx.originalConversation ?? []).map((t: any) => ({ role: String(t.role), content: String(t.content), ts: typeof t.ts === "number" ? t.ts : null }));
    const c: CaseResult = { id: g.key, createdAt: new Date(g.created).toISOString(), customerName: ctx.contact?.displayName ?? ctx.binding?.customerName ?? null,
      inboundText: String(payload.incomingMessage ?? ""), conversation: conv, arms, aIs: randomInt(2) === 0 ? "current" : "trimmed" };
    process.stdout.write(`current ${arms.current.ok ? "valid" : "INVALID"}, trimmed ${arms.trimmed.ok ? "valid" : "INVALID"}; judging... `);
    if (arms.current.ok || arms.trimmed.ok) {
      const saved = { bookingContext: ctx.bookingContext ?? null, openStaffTasks: ctx.openStaffTasks ?? null, unavailableRecords: ctx.unavailableRecords ?? [],
        quoteState: ctx.smsBookingQuote ?? null, earlierMessagesOmitted: ctx.earlierMessagesOmitted ?? 0 };
      try { c.judge = await judgeCase(judgeSys, c, saved); store.judgeCost += c.judge.cost; }
      catch (e: any) { c.judge = { a: zeroSide(), b: zeroSide(), meaningful_difference: false, difference_summary: "", cost: 0, error: String(e?.message ?? e).slice(0, 160) }; }
    }
    store.cases.push(c); save();
    console.log(`done (spend so far ${money(spent())})`);
  }
  save();
  const a = summary(store, "current"), b = summary(store, "trimmed");
  const fmt = (x: ReturnType<typeof summary>) => `score ${x.score.toFixed(2)} | service ${x.service.toFixed(1)} | task ${x.task.toFixed(1)} | booking ${x.booking.toFixed(1)} | truthful ${x.truthful.toFixed(1)} | task decisions ${x.taskCorrect}/${x.n} | false claims ${x.falseClaims} | critical ${x.criticalCases} | usable ${x.ok}/${x.n} | retried ${x.retried}`;
  let w = 0, l = 0, t = 0; for (const c of store.cases) { const d = score(c, "trimmed") - score(c, "current"); if (d >= 0.5) w++; else if (d <= -0.5) l++; else t++; }
  console.log("\n===== SUMMARY (safe to paste: no customer details) =====");
  console.log(`Messages: ${store.cases.length} of ${store.dataset?.length ?? store.cases.length}${store.stoppedForBudget ? " (stopped at the spending stop)" : ""}`);
  console.log(`Current: ${fmt(a)}`);
  console.log(`Trimmed: ${fmt(b)}`);
  console.log(`Trimmed better ${w} / worse ${l} / tie ${t} | meaningful disagreements ${store.cases.filter(c => disagreement(c).length).length}`);
  console.log(`Instructions: ${store.promptSizes?.current.toLocaleString() ?? "?"} -> ${store.promptSizes?.trimmed.toLocaleString() ?? "?"} characters | test spend ${money(spent())}`);
  console.log(`Report: ${reportPath}`);
  rl.close(); process.exit(0);
}
main().catch(e => { console.error(`\n${String(e?.message ?? e)}`); rl.close(); process.exit(1); });
