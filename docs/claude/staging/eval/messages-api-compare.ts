/**
 * ONE-TIME COMPARISON (not an app feature): today's connection (saved-agent sessions, Managed Agents) vs the direct
 * Messages API connection on branch claude/messages-api, for every kind of request runInitialLeadDraft makes.
 * Run on the owner's Mac from the LeadFlow folder, on branch claude/messages-api:
 *   pnpm exec tsx docs/claude/staging/eval/messages-api-compare.ts --smoke     (2 SMS messages, a few cents)
 *   pnpm exec tsx docs/claude/staging/eval/messages-api-compare.ts             (full run, about 18 requests)
 *   pnpm exec tsx docs/claude/staging/eval/messages-api-compare.ts --quick     (release check: direct connection only,
 *     one real request of each kind + 3 SMS for the cache + the 6-minute cache check; no judge; about $0.10-0.30)
 *
 *  - Reads recent production requests from the saved agent's session history, read-only: the exact fixed instructions
 *    and exact customer part production sent. Kinds: automatic SMS replies (3 callers: SMS generation, booking quote,
 *    SMS application), email replies, customer AI-call tasks, staff-call tasks, Thumbtack first responses, complaint scan.
 *  - Sends each request twice, with production's own code: runInitialLeadDraftOn("managed_agents") (today) and
 *    runInitialLeadDraftOn("messages_api") (new; SMS with the 1-hour cache exactly as the app will). Each side gets
 *    production's single retry. Every output goes through that workflow's production checks.
 *  - Measures latency, tokens, cache writes (1 hour / 5 minutes) and cache reads, and cost. The SMS messages run back to
 *    back, so the first direct SMS request writes the 1-hour cache and the following ones must read it. At the end, one
 *    more direct SMS request is sent after more than 5 minutes have passed, to show the cache outlives the old 5 minutes.
 *  - An Opus 5.5 judge compares randomized "Output A / Output B" blind, on practical outcomes only.
 * Nothing is sent to customers, no task is created and nothing is written to a database. Only api.anthropic.com is
 * contacted. The whole run stops at $5 of new spend (expected about $2-3).
 * Output (stays on this Mac; contains real customer data): ~/leadflow-messages-api/report.html and results.json
 */
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ---------- settings ----------
const MOCK_ORIGIN = process.env.EVAL_ANTHROPIC_ORIGIN; // tests only: a local fake server
const QUICK = process.argv.includes("--quick");
const OUT_DIR = process.env.EVAL_OUT_DIR ?? path.join(os.homedir(), QUICK ? "leadflow-messages-api-check" : "leadflow-messages-api");
const SMOKE = process.argv.includes("--smoke");
const TOTAL_STOP_DOLLARS = QUICK ? 1 : 5, NEW_CASE_STOP_DOLLARS = QUICK ? 0.8 : 4.4, MAX_SESSIONS_SCANNED = 4000;
const TTL_CHECK_AFTER_MS = Number(process.env.EVAL_TTL_CHECK_AFTER_MS ?? 6 * 60_000);
type Kind = "sms" | "email" | "customer_call" | "staff_call" | "thumbtack" | "complaint";
const PLAN: Record<Kind, number> = QUICK ? { sms: 3, email: 1, customer_call: 1, staff_call: 1, thumbtack: 1, complaint: 1 } : SMOKE ? { sms: 2, email: 0, customer_call: 0, staff_call: 0, thumbtack: 0, complaint: 0 }
  : { sms: 8, email: 2, customer_call: 2, staff_call: 2, thumbtack: 2, complaint: 2 };
const KIND_LABEL: Record<Kind, string> = { sms: "Automatic SMS reply", email: "Email reply", customer_call: "Customer AI-call task",
  staff_call: "Staff-call task", thumbtack: "Thumbtack first response", complaint: "Complaint scan" };
const SMS_PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===", EMAIL_PREFIX = "=== CURRENT CAPABILITY — HIGHEST PRIORITY ===";
const JUDGE_MODEL = "claude-opus-5-5";
const PRICE = { // $ per million tokens (published)
  sonnet: { in: 2, out: 10, read: 0.1, write5m: 2.5, write1h: 4 }, opus: { in: 4, out: 20, read: 0.2, write5m: 5 } };
const RUNTIME_PER_HOUR = 0.08;
type Arm = "managed" | "direct";
const ARMS: Arm[] = QUICK ? ["direct"] : ["managed", "direct"];
const NOT_RUN: ArmResult = { ok: false, error: "not run (quick check)", calls: [], ms: 0, cost: 0 };
const ARM_LABEL: Record<Arm, string> = { managed: "Today (Managed Agents)", direct: "New (direct Messages API)" };

// ---------- only Anthropic may be contacted ----------
for (const name of ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID"]) delete process.env[name];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw);
  if (url.origin !== "https://api.anthropic.com") throw new Error(`EVAL_BLOCKED_HOST ${url.host}`);
  if (!MOCK_ORIGIN) return realFetch(input, init);
  const target = new URL(url.pathname + url.search, MOCK_ORIGIN);
  return typeof input === "string" || input instanceof URL ? realFetch(target, init) : realFetch(new Request(target, input), init);
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
interface Usage { input: number; output: number; cacheRead: number; write5m: number; write1h: number; requests: number }
interface Call { id: string; ok: boolean; ms: number; usage: Usage; cost: number; output: string | null; error?: string }
interface ArmResult { ok: boolean; error?: string; calls: Call[]; ms: number; cost: number; output?: unknown }
interface JudgeSide { accuracy: number; task: number; truthful: number; format_ok: boolean; critical_errors: { category: string; explanation: string }[]; notes: string }
interface CaseResult { key: string; kind: Kind; createdAt: string; userText: string; systemChars: number; arms: Record<Arm, ArmResult>; aIs: Arm;
  judge?: { a: JudgeSide; b: JudgeSide; meaningful_difference: boolean; difference_summary: string; cost: number; error?: string } }
interface Store { startedAt: string; agentModel: unknown; cases: CaseResult[]; judgeCost: number; stoppedForBudget: boolean; notes: string[];
  ownIds: string[]; dataset?: string[]; ttlCheck?: { minutesAfterLastSms: number; usage: Usage; cost: number; ok: boolean; error?: string };
  smsDistinctInstructions?: number; smsScanned?: number }
const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, write5m: 0, write1h: 0, requests: 0 });
const sum = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
  write5m: a.write5m + b.write5m, write1h: a.write1h + b.write1h, requests: a.requests + b.requests });
const sonnetCost = (u: Usage, runtimeMs = 0) => (u.input * PRICE.sonnet.in + u.output * PRICE.sonnet.out + u.cacheRead * PRICE.sonnet.read
  + u.write5m * PRICE.sonnet.write5m + u.write1h * PRICE.sonnet.write1h) / 1e6 + runtimeMs / 3.6e6 * RUNTIME_PER_HOUR;
const fingerprint = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return `${s.length}:${h >>> 0}`; };

// ---------- production code ----------
async function loadProduction() {
  return {
    client: await import("../../../../server/instinct/claudeAgentClient"),
    gen: await import("../../../../server/instinct/claudeCustomerSmsGeneration"),
    quote: await import("../../../../server/instinct/smsBookingQuote"),
    tasks: await import("../../../../shared/claudeCustomerTasks"),
    calls: await import("../../../../server/instinct/claudeCustomerCalls"),
    staff: await import("../../../../server/instinct/claudeStaffCalls"),
    complaint: await import("../../../../server/teamLeaderboardComplaintDetect"),
    review: await import("../../../../shared/claudeSmsAlternative"),
  };
}
type Prod = Awaited<ReturnType<typeof loadProduction>>;
let prod: Prod;
let KEY = "";

// ---------- read-only session history (Managed Agents) ----------
async function api(p: string): Promise<any> {
  const r = await fetch(`https://api.anthropic.com${p}`, { headers: { "x-api-key": KEY, "anthropic-version": prod.client.ANTHROPIC_VERSION,
    "anthropic-beta": prod.client.ANTHROPIC_BETA, accept: "application/json" } });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`HTTP_${r.status} ${p.split("?")[0].split("/").slice(0, 3).join("/")} ${t.slice(0, 200)}`); }
  return r.json();
}
async function* paged(p: string): AsyncGenerator<any> {
  let page: string | null = null;
  do {
    const r = await api(`${p}${p.includes("?") ? "&" : "?"}limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`);
    for (const item of r.data ?? []) yield item;
    page = r.next_page ?? null;
  } while (page);
}
async function sessionEvents(id: string): Promise<any[]> { const all: any[] = []; for await (const ev of paged(`/v1/sessions/${id}/events`)) all.push(ev); return all; }
function sessionFacts(events: any[]): { userText: string | null; usage: Usage; runMs: number } {
  const usage = emptyUsage(); let userText: string | null = null, runStart: number | null = null, runMs = 0;
  for (const ev of events) {
    const at = ev.processed_at ? Date.parse(ev.processed_at) : NaN;
    if (ev.type === "user.message" && userText === null) userText = (ev.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    else if (ev.type === "span.model_request_end") {
      const m = ev.model_usage ?? {}; usage.requests++;
      usage.input += m.input_tokens ?? 0; usage.output += m.output_tokens ?? 0; usage.cacheRead += m.cache_read_input_tokens ?? 0;
      const c = m.cache_creation ?? null; // split when reported; otherwise Managed Agents' fixed 5-minute cache
      usage.write1h += c?.ephemeral_1h_input_tokens ?? 0;
      usage.write5m += c ? (c.ephemeral_5m_input_tokens ?? 0) : (m.cache_creation_input_tokens ?? 0);
    } else if (ev.type === "session.status_running" && !isNaN(at)) runStart = at;
    else if (ev.type === "session.status_idle" && !isNaN(at) && runStart !== null) { runMs += at - runStart; runStart = null; }
  }
  return { userText, usage, runMs };
}
function classify(system: string, userText: string): Kind | null {
  if (system.startsWith(SMS_PREFIX)) return "sms";
  if (system.startsWith(EMAIL_PREFIX)) return "email";
  if (system === prod.calls.CLAUDE_CUSTOMER_CALL_TASK_INSTRUCTIONS) return "customer_call";
  if (system === prod.staff.CLAUDE_STAFF_CALL_TASK_INSTRUCTIONS) return "staff_call";
  if (system === prod.complaint.TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS) return "complaint";
  if (userText.includes("Customer service scenario:") && userText.includes("Thumbtack lead:")) return "thumbtack";
  return null;
}

// ---------- production checks for each kind ----------
function check(kind: Kind, text: string, payloadText: string, receivedAt: number): { ok: boolean; output?: unknown; error?: string } {
  try {
    if (kind === "thumbtack") // Production's first-response check (validateClaudeReviewReply) is exactly this format check.
      return { ok: true, output: { replyText: prod.review.claudeSmsAlternativeReplySchema.parse({ replyText: text }).replyText } };
    const payload = JSON.parse(payloadText), value = JSON.parse(text);
    if (kind === "email") {
      const plan = prod.gen.validateClaudeCustomerReplyPlan(text, { incomingMessage: payload.incomingMessage, context: payload.context, protectedIds: [] });
      return { ok: true, output: plan };
    }
    if (kind === "customer_call" || kind === "staff_call") {
      const plan = prod.calls.customerCallPlanSchema.parse(value);
      // The exact caller-line list is not part of the saved request; quotes are checked against the full transcript.
      const transcript = JSON.stringify(payload.source ?? {});
      if (plan.task?.items.some(item => !transcript.includes(JSON.stringify(item.evidenceQuote).slice(1, -1)))) throw new Error("TASK_EVIDENCE_NOT_IN_TRANSCRIPT");
      return { ok: true, output: plan };
    }
    if (kind === "complaint") return { ok: true, output: { candidates: prod.complaint.validateTeamComplaintExtraction(value, payload.source) } };
    // Automatic SMS: the same checks production applies, in the same order.
    const schema = prod.tasks.customerReplyPlanSchema.extend({
      bookingQuote: prod.quote.smsBookingQuoteUpdateSchema.nullable().optional().default(null),
      quoteTextTemplate: z.string().min(1).nullable().optional().default(null),
      quotePresentationLanguage: z.enum(["en", "es"]).nullable().optional().default(null),
    }).strict();
    const parsed: any = schema.parse(value);
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
      const current = turns.filter(turn => turn && ["user", "customer"].includes(String(turn.role))).at(-1);
      if (current) current.opMsgId = "eval"; // the app's provider-message link, which the model input does not carry
      prod.quote.advanceSmsBookingQuote(previous, parsed.bookingQuote, { binding: binding as any, originalConversation: turns, nowMs: receivedAt });
      prod.quote.assertSmsBookingQuoteModelText(plan.replyText);
      if (/[{}]/.test(plan.replyText)) throw new Error("SMS_QUOTE_TEMPLATE_IN_REPLY");
    }
    return { ok: true, output: { replyText: plan.replyText, task: plan.task ?? null, bookingQuote: parsed.bookingQuote, quotePresentationLanguage: parsed.quotePresentationLanguage } };
  } catch (e: any) { return { ok: false, error: `CHECK: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}` }; }
}

// ---------- one request on one connection, with production's code ----------
let usageLines: any[] = [];
const realInfo = console.info.bind(console);
console.info = (...args: unknown[]) => { // capture the app's own usage log line (counts only)
  const line = String(args[0] ?? "");
  if (line.startsWith("[claude-usage] ")) { usageLines.push(JSON.parse(line.slice(15))); return; }
  realInfo(...args);
};
async function once(arm: Arm, kind: Kind, system: string, user: string): Promise<{ id: string; text: string | null; usage: Usage; ms: number; error?: string }> {
  usageLines = [];
  const t0 = Date.now();
  const options = { systemPrompt: system, userPrompt: user, ...(arm === "direct" && kind === "sms" ? { cacheTtl: "1h" as const } : {}),
    signal: AbortSignal.timeout(240_000) };
  let id = "", text: string | null = null, error: string | undefined;
  try {
    const r = await prod.client.runInitialLeadDraftOn(arm === "managed" ? "managed_agents" : "messages_api", options);
    id = r.sessionId; text = r.finalSmsText;
  } catch (e: any) { id = e?.sessionId ?? ""; error = `${e?.code ?? "ERROR"}${e?.status ? ` ${e.status}` : ""}`; }
  const ms = Date.now() - t0;
  let usage = emptyUsage();
  if (arm === "direct") {
    for (const u of usageLines) usage = sum(usage, { input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens,
      write5m: u.cacheCreation5mTokens, write1h: u.cacheCreation1hTokens, requests: 1 });
    if (!id && usageLines[0]) id = usageLines[0].messageId;
  } else if (id) {
    await new Promise(r => setTimeout(r, 500));
    usage = sessionFacts(await sessionEvents(id).catch(() => [])).usage;
  }
  return { id, text, usage, ms, ...(error ? { error } : {}) };
}
async function runArm(arm: Arm, kind: Kind, system: string, user: string, receivedAt: number, own: string[]): Promise<ArmResult> {
  const calls: Call[] = [];
  let result: ReturnType<typeof check> = { ok: false, error: "NOT_RUN" };
  for (let attempt = 0; attempt < 2 && !result.ok; attempt++) { // production's single retry
    const r = await once(arm, kind, system, user);
    if (r.id) own.push(r.id);
    result = r.text === null ? { ok: false, error: r.error ?? "NO_OUTPUT" } : check(kind, r.text, user, receivedAt);
    calls.push({ id: r.id, ok: result.ok, ms: r.ms, usage: r.usage, cost: sonnetCost(r.usage, arm === "managed" ? r.ms : 0), output: r.text,
      ...(result.ok ? {} : { error: result.error }) });
  }
  return { ok: result.ok, ...(result.ok ? { output: result.output } : { error: result.error }), calls,
    ms: calls.reduce((s, c) => s + c.ms, 0), cost: calls.reduce((s, c) => s + c.cost, 0) };
}

// ---------- blind judge: practical outcomes only ----------
const CRITICAL = ["false_claim_of_completed_action", "wrong_fact_or_detail", "missed_task", "invented_task", "wrong_booking_or_quote",
  "contradicts_instructions", "invalid_or_unusable_output", "inappropriate_content", "other"];
const SIDE = { type: "object", additionalProperties: false, required: ["accuracy", "task", "truthful", "format_ok", "critical_errors", "notes"],
  properties: { accuracy: { type: "integer" }, task: { type: "integer" }, truthful: { type: "integer" }, format_ok: { type: "boolean" }, notes: { type: "string" },
    critical_errors: { type: "array", items: { type: "object", additionalProperties: false, required: ["category", "explanation"],
      properties: { category: { type: "string", enum: CRITICAL }, explanation: { type: "string" } } } } } };
const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["output_a", "output_b", "meaningful_difference", "difference_summary"],
  properties: { output_a: SIDE, output_b: SIDE, meaningful_difference: { type: "boolean" }, difference_summary: { type: "string" } } };
function judgeSystem(kind: Kind, instructions: string): string {
  return `You are an impartial evaluator for Maids in Black, a residential cleaning company. One AI request (${KIND_LABEL[kind]}) was answered twice, independently, from the identical instructions and input. You see the input and the two outputs, "Output A" and "Output B". Their origin is hidden and randomized; NEITHER is a reference answer. Judge each only against the input and the instructions below.

JUDGE PRACTICAL OUTCOMES ONLY. Do NOT reward or penalize wording, tone, length or style. Two outputs that lead to the same customer outcome and the same staff work are equal.

Score each output 0-10 (10 = fully correct, 7 = acceptable with a minor practical issue, 4 = a real problem, 0 = wrong or unusable):
- accuracy: correct, relevant content for this input (answers the customer correctly, or extracts the right facts), consistent with the instructions and saved context.
- task: correct staff-task / complaint-candidate decision and items, with evidence that really appears in the input. 10 if none was needed and none was produced.
- truthful: no false claim that an action was completed, no promised availability or outcome, no invented facts.
Set format_ok to false if the output does not follow the required output format. List critical_errors only for serious practical problems. An output shown as "NO USABLE OUTPUT" scores 0 on everything.
Set meaningful_difference to true only if the two outputs would lead to materially different customer outcomes or staff work.

=== INSTRUCTIONS BOTH OUTPUTS WERE GIVEN ===
${instructions}`;
}
const zeroSide = (): JudgeSide => ({ accuracy: 0, task: 0, truthful: 0, format_ok: false, critical_errors: [], notes: "" });
function clampSide(s: any): JudgeSide {
  const c = (n: any) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
  return { accuracy: c(s?.accuracy), task: c(s?.task), truthful: c(s?.truthful), format_ok: !!s?.format_ok,
    critical_errors: Array.isArray(s?.critical_errors) ? s.critical_errors : [], notes: String(s?.notes ?? "") };
}
const shown = (a: ArmResult) => a.ok ? JSON.stringify(a.output, null, 1) : `NO USABLE OUTPUT (${a.error ?? "failed"})`;
async function judge(system: string, c: CaseResult) {
  const A = c.arms[c.aIs], B = c.arms[c.aIs === "managed" ? "direct" : "managed"];
  const client = new Anthropic({ apiKey: KEY, baseURL: "https://api.anthropic.com", maxRetries: 0 });
  const r: any = await client.messages.create({ model: JUDGE_MODEL, max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema", schema: JUDGE_SCHEMA } } as any,
    system: [{ type: "text", text: judgeSystem(c.kind, system), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `INPUT (exactly as both received it):\n${c.userText}\n\n=== Output A ===\n${shown(A)}\n\n=== Output B ===\n${shown(B)}` }] });
  const u = r.usage ?? {};
  const cost = ((u.input_tokens ?? 0) * PRICE.opus.in + (u.output_tokens ?? 0) * PRICE.opus.out + (u.cache_read_input_tokens ?? 0) * PRICE.opus.read
    + (u.cache_creation_input_tokens ?? 0) * PRICE.opus.write5m) / 1e6;
  if (r.stop_reason !== "end_turn") return { a: zeroSide(), b: zeroSide(), meaningful_difference: false, difference_summary: "", cost, error: `JUDGE_${r.stop_reason}` };
  const j = JSON.parse((r.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""));
  return { a: clampSide(j.output_a), b: clampSide(j.output_b), meaningful_difference: !!j.meaningful_difference, difference_summary: String(j.difference_summary ?? ""), cost };
}

// ---------- scoring ----------
const sideFor = (c: CaseResult, arm: Arm): JudgeSide | null => !c.judge || c.judge.error ? null : c.aIs === arm ? c.judge.a : c.judge.b;
const score = (c: CaseResult, arm: Arm) => { const s = sideFor(c, arm) ?? zeroSide(); return c.arms[arm].ok ? 0.4 * s.accuracy + 0.3 * s.task + 0.3 * s.truthful : 0; };
function criticals(c: CaseResult, arm: Arm) {
  const list = [...(sideFor(c, arm)?.critical_errors ?? [])];
  if (!c.arms[arm].ok) list.unshift({ category: "no_usable_output", explanation: c.arms[arm].error ?? "failed" });
  return list;
}
const taskOf = (c: CaseResult, arm: Arm): string => {
  const o: any = c.arms[arm].output; if (!c.arms[arm].ok || !o) return "n/a";
  if (c.kind === "complaint") return o.candidates?.length ? "candidate" : "none";
  if (c.kind === "thumbtack") return "none";
  return o.task ? "task" : "none";
};
function differences(c: CaseResult): string[] {
  const why: string[] = [];
  if (c.arms.managed.ok !== c.arms.direct.ok) why.push("only one connection produced a usable output");
  if (c.arms.managed.ok && c.arms.direct.ok && taskOf(c, "managed") !== taskOf(c, "direct")) why.push("different staff-task decision");
  if (Math.abs(score(c, "managed") - score(c, "direct")) >= 1.5) why.push("score gap of 1.5 or more");
  if (criticals(c, "managed").length || criticals(c, "direct").length) why.push("critical error");
  if (c.judge?.meaningful_difference) why.push("judge: materially different outcome");
  if (c.judge?.error) why.push(`judge could not score (${c.judge.error})`);
  return why;
}
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function summary(cases: CaseResult[], arm: Arm) {
  const A = cases.map(c => c.arms[arm]), n = cases.length;
  const firstCalls = A.map(a => a.calls[0]).filter(Boolean);
  return { n, ok: A.filter(a => a.ok).length, retried: A.filter(a => a.calls.length > 1).length,
    score: n ? cases.reduce((s, c) => s + score(c, arm), 0) / n : 0,
    critical: cases.filter(c => criticals(c, arm).length).length,
    falseClaims: cases.filter(c => (sideFor(c, arm)?.critical_errors ?? []).some(e => e.category === "false_claim_of_completed_action")).length,
    formatOk: cases.filter(c => c.arms[arm].ok && (sideFor(c, arm)?.format_ok ?? false)).length,
    medianMs: median(firstCalls.map(k => k.ms)), cost: A.reduce((s, a) => s + a.cost, 0),
    usage: A.flatMap(a => a.calls).reduce((u, k) => sum(u, k.usage), emptyUsage()) };
}

// ---------- report ----------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const money = (x: number) => `$${x.toFixed(x < 1 ? 4 : 2)}`;
const tok = (u: Usage) => `in ${u.input.toLocaleString()} · cache read ${u.cacheRead.toLocaleString()} · cache write 1h ${u.write1h.toLocaleString()} / 5m ${u.write5m.toLocaleString()} · out ${u.output.toLocaleString()}`;
function armHtml(c: CaseResult, arm: Arm) {
  const a = c.arms[arm], s = sideFor(c, arm), crit = criticals(c, arm);
  return `<td><h4>${ARM_LABEL[arm]} <span class="small">(was Output ${c.aIs === arm ? "A" : "B"})</span> · score ${score(c, arm).toFixed(1)}</h4>
    ${a.ok ? `<pre class="out">${esc(JSON.stringify(a.output, null, 1))}</pre>` : `<div class="fail">NO USABLE OUTPUT: ${esc(a.error)}</div>`}
    ${crit.length ? `<div class="crit">${crit.map(e => `⚠ ${esc(e.category)}: ${esc(e.explanation)}`).join("<br>")}</div>` : ""}
    ${s ? `<div class="small">accuracy ${s.accuracy} · task ${s.task} · truthful ${s.truthful} · format ${s.format_ok ? "ok" : "WRONG"}<br><i>${esc(s.notes)}</i></div>` : ""}
    ${a.calls.map((k, i) => `<div class="small">attempt ${i + 1}: ${k.ok ? "passed checks" : `failed (${esc(k.error)})`} · ${(k.ms / 1000).toFixed(1)}s · ${money(k.cost)}<br>${tok(k.usage)}</div>`).join("")}</td>`;
}
function caseHtml(c: CaseResult, i: number) {
  const why = differences(c);
  return `<section id="case-${i + 1}"><h3>Case ${i + 1} · ${KIND_LABEL[c.kind]} · ${esc(c.createdAt)} ${why.length ? `<span class="tag">${esc(why.join("; "))}</span>` : ""}</h3>
    <details><summary>Input (customer part, ${c.userText.length.toLocaleString()} characters; fixed instructions ${c.systemChars.toLocaleString()} characters)</summary><pre>${esc(c.userText.slice(0, 20000))}</pre></details>
    ${c.judge?.difference_summary ? `<div class="small"><b>Judge on the difference:</b> ${esc(c.judge.difference_summary)}</div>` : ""}
    <table class="side"><tr>${armHtml(c, "managed")}${armHtml(c, "direct")}</tr></table></section>`;
}
function smsCacheRows(store: Store) {
  return store.cases.filter(c => c.kind === "sms").map((c, i) => { const k = c.arms.direct.calls[0]; return k
    ? `<tr><td>SMS ${i + 1}</td><td>${k.usage.write1h.toLocaleString()}</td><td>${k.usage.write5m.toLocaleString()}</td><td>${k.usage.cacheRead.toLocaleString()}</td><td>${k.usage.input.toLocaleString()}</td><td>${money(k.cost)}</td></tr>` : ""; }).join("");
}
function report(store: Store): string {
  const kinds = [...new Set(store.cases.map(c => c.kind))];
  const row = (k: string, x: string, y: string) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td></tr>`;
  const block = (title: string, cases: CaseResult[]) => {
    const m = summary(cases, "managed"), d = summary(cases, "direct");
    return `<h3>${esc(title)} (${cases.length})</h3><table><tr><th></th><th>${ARM_LABEL.managed}</th><th>${ARM_LABEL.direct}</th></tr>
    ${row("Practical score (0-10)", m.score.toFixed(2), d.score.toFixed(2))}${row("Passed the production checks", `${m.ok} of ${m.n}`, `${d.ok} of ${d.n}`)}
    ${row("Output format right (judge)", `${m.formatOk} of ${m.n}`, `${d.formatOk} of ${d.n}`)}${row("Needed the retry", String(m.retried), String(d.retried))}
    ${row("False claims of completed actions", String(m.falseClaims), String(d.falseClaims))}${row("Cases with a critical error", String(m.critical), String(d.critical))}
    ${row("Median time per request", `${(m.medianMs / 1000).toFixed(1)}s`, `${(d.medianMs / 1000).toFixed(1)}s`)}
    ${row("Measured cost", money(m.cost), money(d.cost))}${row("Tokens", tok(m.usage), tok(d.usage))}</table>`;
  };
  const dis = store.cases.map((c, i) => ({ i, why: differences(c) })).filter(x => x.why.length);
  const ttl = store.ttlCheck;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Messages API comparison</title><style>
  body{font:14px/1.45 -apple-system,Segoe UI,sans-serif;margin:16px;color:#1d1d1f;background:#fff} table{border-collapse:collapse} td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
  .side{width:100%;table-layout:fixed} .out{background:#eef6ff;border-radius:8px;padding:8px} .crit{color:#b00020;font-weight:600;margin:6px 0} .fail{color:#b00020;font-weight:600}
  .small{font-size:12px;color:#555} pre{white-space:pre-wrap;font-size:12px;margin:2px 0} .tag{font-size:12px;background:#ffe4e4;color:#900;padding:2px 6px;border-radius:4px}
  section{border-top:2px solid #ccc;margin-top:18px;padding-top:6px} h4{margin:2px 0 6px}
  @media (prefers-color-scheme: dark){body{background:#111;color:#eee}.out{background:#1b2a3a}td,th{border-color:#444}.small{color:#aaa}}
  </style></head><body><h1>Today's connection vs direct Messages API</h1>
  <p class="small">Recent production requests, each sent fresh through production's own code on both connections, with the same model and saved settings (${esc(JSON.stringify(store.agentModel))}). Outputs went through each workflow's production checks with the single retry. An Opus 5.5 judge compared randomized outputs on practical outcomes only. Started ${esc(store.startedAt)}.</p>
  <h2>Summary</h2>${block("All requests", store.cases)}${kinds.map(k => block(KIND_LABEL[k], store.cases.filter(c => c.kind === k))).join("")}
  <h2>1-hour cache on automatic SMS (direct connection, first attempt of each message, in order)</h2>
  <p class="small">${store.smsDistinctInstructions ?? "?"} different fixed-instruction versions among the ${store.smsScanned ?? "?"} most recent production SMS requests (1 means every customer shares one cache).</p>
  <table><tr><th>Message</th><th>Cache write 1h</th><th>Cache write 5m</th><th>Cache read</th><th>Normal-price input</th><th>Cost</th></tr>${smsCacheRows(store)}</table>
  ${ttl ? `<p><b>Cache after ${ttl.minutesAfterLastSms.toFixed(1)} minutes without SMS traffic:</b> ${tok(ttl.usage)} (${money(ttl.cost)}) ${ttl.usage.cacheRead > 0 ? "→ still cached (outlived the old 5 minutes)" : "→ NOT read from cache"}${ttl.error ? ` · ${esc(ttl.error)}` : ""}</p>` : ""}
  <p class="small">Test spend: requests ${money(store.cases.reduce((s, c) => s + c.arms.managed.cost + c.arms.direct.cost, 0) + (ttl?.cost ?? 0))} + judge ${money(store.judgeCost)} (measured tokens × published prices; Managed Agents runtime included).</p>
  <h2>Meaningful differences (${dis.length})</h2>${dis.length ? `<ul>${dis.map(x => `<li><a href="#case-${x.i + 1}">Case ${x.i + 1}</a> (${KIND_LABEL[store.cases[x.i].kind]}): ${esc(x.why.join("; "))}</li>`).join("")}</ul>` : "<p>None.</p>"}
  ${store.notes.length ? `<p class="small">Notes: ${esc(store.notes.join("; "))}</p>` : ""}${store.stoppedForBudget ? `<p class="crit">Stopped at the $${TOTAL_STOP_DOLLARS} spending stop.</p>` : ""}
  <h2>All requests, side by side</h2>${store.cases.map(caseHtml).join("")}</body></html>`;
}

// ---------- main ----------
async function main() {
  console.log(QUICK ? "LeadFlow release check: real requests on the direct Messages API connection (read-only, no customer contact)."
    : "LeadFlow one-time comparison: today's connection (Managed Agents) vs the direct Messages API.");
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(OUT_DIR, "results.json"), reportPath = path.join(OUT_DIR, "report.html");
  KEY = await ask("Paste the Anthropic API key created for this test (hidden), then press Enter: ", true);
  if (!KEY) throw new Error("STOP: no API key entered.");
  process.env.ANTHROPIC_API_KEY = KEY; // in memory for this process only; production code reads it from here
  prod = await loadProduction();
  if (prod.client.CLAUDE_TRANSPORT !== "messages_api") throw new Error("STOP: run this from branch claude/messages-api.");

  // The saved agent's model settings must be exactly what the direct connection sends (model, low effort).
  const agent = await api(`/v1/agents/${prod.client.EXISTING_AGENT_ID}`); // read-only
  if (agent.version !== prod.client.EXISTING_AGENT_VERSION || agent.archived_at) throw new Error("STOP: the saved agent is not the version production uses.");
  const model = agent.model ?? {}, effort = typeof model.effort === "string" ? model.effort : model.effort?.type;
  const extra = Object.keys(model).filter(k => !["id", "effort", "speed"].includes(k) || (k === "speed" && model.speed !== "standard"));
  if (effort !== prod.client.MESSAGES_API_EFFORT || extra.length) {
    throw new Error(`STOP before any spending: the saved agent's model settings differ from the direct connection (effort ${JSON.stringify(model.effort)}, other settings: ${extra.join(", ") || "none"}). Send this line to Claude.`);
  }
  const store: Store = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, "utf8"))
    : { startedAt: new Date().toISOString(), agentModel: { ...model, id: prod.client.SESSION_MODEL_ID }, cases: [], judgeCost: 0, stoppedForBudget: false, notes: [], ownIds: [] };
  store.stoppedForBudget = false;
  const save = () => { fs.writeFileSync(resultsPath, JSON.stringify(store), { mode: 0o600 }); fs.writeFileSync(reportPath, report(store), { mode: 0o600 }); };
  const spent = () => store.cases.reduce((s, c) => s + c.arms.managed.cost + c.arms.direct.cost, 0) + store.judgeCost + (store.ttlCheck?.cost ?? 0);

  // 1. Recent production requests of each kind (read-only), newest first.
  console.log("Reading recent production requests from the saved agent's session history (read-only)...");
  const startedAt = Date.parse(store.startedAt), own = new Set(store.ownIds), wanted = store.dataset ? new Set(store.dataset) : null;
  const found: Record<Kind, Array<{ key: string; kind: Kind; created: number; system: string; userText: string }>> =
    { sms: [], email: [], customer_call: [], staff_call: [], thumbtack: [], complaint: [] };
  const smsVersions = new Map<string, number>(); let scanned = 0, smsSeen = 0;
  const full = () => (Object.keys(PLAN) as Kind[]).every(k => found[k].length >= PLAN[k]);
  for await (const s of paged("/v1/sessions?order=desc")) {
    if (++scanned > MAX_SESSIONS_SCANNED || (!wanted && full())) break;
    if (own.has(s.id) || Date.parse(s.created_at) >= startedAt) continue;
    const detail = s?.agent?.system !== undefined ? s : await api(`/v1/sessions/${s.id}`);
    if (detail?.agent?.id !== prod.client.EXISTING_AGENT_ID || typeof detail.agent.system !== "string") continue;
    if (!["idle", "terminated"].includes(String(detail.status))) continue;
    const system = detail.agent.system;
    const quick = system.startsWith(SMS_PREFIX) ? "sms" : null;
    if (quick === "sms" && !wanted && found.sms.length >= PLAN.sms) { smsSeen++; smsVersions.set(fingerprint(system), 1); continue; }
    const facts = sessionFacts(await sessionEvents(detail.id));
    if (facts.userText === null) continue;
    const kind = classify(system, facts.userText);
    if (!kind) continue;
    const key = `${detail.id}`;
    if (kind === "sms") { smsSeen++; smsVersions.set(fingerprint(system), 1); }
    if (wanted ? !wanted.has(key) : found[kind].length >= PLAN[kind]) continue;
    if (found[kind].some(f => f.userText === facts.userText)) continue; // a production retry of the same request
    // The SMS messages share one instructions version, so the cache test is meaningful.
    if (kind === "sms" && found.sms.length && fingerprint(found.sms[0].system) !== fingerprint(system) && !wanted) continue;
    found[kind].push({ key, kind, created: Date.parse(detail.created_at), system, userText: facts.userText });
    if (wanted && [...wanted].every(k => (Object.values(found).flat()).some(f => f.key === k))) break;
  }
  store.smsDistinctInstructions = smsVersions.size; store.smsScanned = smsSeen;
  const order: Kind[] = ["sms", "email", "customer_call", "staff_call", "thumbtack", "complaint"];
  const chosen = order.flatMap(k => found[k].slice().reverse()); // oldest first within a kind
  for (const k of order) if (found[k].length < PLAN[k]) store.notes.push(`${KIND_LABEL[k]}: ${found[k].length} of ${PLAN[k]} found in the recent history`);
  if (!wanted && !SMOKE && !QUICK) { store.dataset = chosen.map(c => c.key); }
  save();
  console.log(`Scanned ${scanned} sessions: ${order.map(k => `${KIND_LABEL[k]} ${found[k].length}`).join(", ")}.`);
  if (!chosen.length) throw new Error("STOP: no recent production requests were found.");

  // 2. Each request on both connections, then the blind judge; saved after every request.
  let lastSmsDirectAt = 0, firstSms: (typeof chosen)[number] | undefined;
  for (const g of chosen) {
    if (g.kind === "sms") firstSms ??= g;
    if (store.cases.some(c => c.key === g.key)) continue;
    if (spent() >= NEW_CASE_STOP_DOLLARS) { store.stoppedForBudget = true; console.log(`Stopped: spend reached ${money(spent())}.`); break; }
    process.stdout.write(`${KIND_LABEL[g.kind]} ${store.cases.length + 1}/${chosen.length}: `);
    const arms = { managed: NOT_RUN } as Record<Arm, ArmResult>;
    for (const arm of ARMS) {
      arms[arm] = await runArm(arm, g.kind, g.system, g.userText, g.created, store.ownIds);
      if (arm === "direct" && g.kind === "sms") lastSmsDirectAt = Date.now();
    }
    const c: CaseResult = { key: g.key, kind: g.kind, createdAt: new Date(g.created).toISOString(), userText: g.userText, systemChars: g.system.length,
      arms, aIs: randomInt(2) === 0 ? "managed" : "direct" };
    process.stdout.write(`today ${arms.managed.ok ? "ok" : "FAILED"}, direct ${arms.direct.ok ? "ok" : "FAILED"}; judging... `);
    if (!QUICK && (arms.managed.ok || arms.direct.ok)) {
      try { c.judge = await judge(g.system, c); store.judgeCost += c.judge.cost; }
      catch (e: any) { c.judge = { a: zeroSide(), b: zeroSide(), meaningful_difference: false, difference_summary: "", cost: 0, error: String(e?.message ?? e).slice(0, 160) }; }
    }
    store.cases.push(c); save();
    console.log(`done (spend so far ${money(spent())})`);
  }

  // 3. The 1-hour cache outlives the old 5 minutes: one more direct SMS request after a quiet period.
  if (!SMOKE && firstSms && !store.ttlCheck && !store.stoppedForBudget && spent() < TOTAL_STOP_DOLLARS) {
    const since = lastSmsDirectAt || Date.now(), wait = Math.max(0, since + TTL_CHECK_AFTER_MS - Date.now());
    if (wait > 0) console.log(`Cache check: waiting ${Math.ceil(wait / 60000)} minute(s) with no SMS traffic, then one more direct SMS request...`);
    await new Promise(r => setTimeout(r, wait));
    const r = await once("direct", "sms", firstSms.system, firstSms.userText);
    if (r.id) store.ownIds.push(r.id);
    store.ttlCheck = { minutesAfterLastSms: (Date.now() - since) / 60000, usage: r.usage, cost: sonnetCost(r.usage), ok: !r.error, ...(r.error ? { error: r.error } : {}) };
    save();
  }
  save();

  // 4. Summary without customer details.
  if (QUICK) {
    console.log("\n===== RELEASE CHECK SUMMARY (safe to paste: no customer details) =====");
    console.log(`Saved agent model settings: ${JSON.stringify(store.agentModel)} (match the direct connection: yes)`);
    for (const c of store.cases) {
      const a = c.arms.direct, k = a.calls[0];
      console.log(`${KIND_LABEL[c.kind]}: ${a.ok ? "PASSED production checks" : `FAILED (${a.error})`} | attempts ${a.calls.length} | ${((k?.ms ?? 0) / 1000).toFixed(1)}s | ${k ? tok(k.usage) : "-"} | ${money(a.cost)}`);
    }
    if (store.ttlCheck) console.log(`Cache after ${store.ttlCheck.minutesAfterLastSms.toFixed(1)} min with no SMS: ${tok(store.ttlCheck.usage)} -> ${store.ttlCheck.usage.cacheRead > 0 ? "STILL CACHED" : "NOT CACHED"}${store.ttlCheck.error ? ` (${store.ttlCheck.error})` : ""}`);
    console.log(`Kinds found: ${order.map(k => `${KIND_LABEL[k]} ${found[k].length}`).join(", ")}${store.notes.length ? ` | notes: ${store.notes.join("; ")}` : ""}`);
    console.log(`Spend ${money(spent())} | Details: ${reportPath}`);
    rl.close(); process.exit(0);
  }
  const line = (title: string, cases: CaseResult[]) => {
    if (!cases.length) return `${title}: none`;
    const m = summary(cases, "managed"), d = summary(cases, "direct");
    let better = 0, worse = 0, tie = 0; for (const c of cases) { const x = score(c, "direct") - score(c, "managed"); if (x >= 0.5) better++; else if (x <= -0.5) worse++; else tie++; }
    const f = (s: ReturnType<typeof summary>) => `score ${s.score.toFixed(2)} | checks ${s.ok}/${s.n} | format ${s.formatOk}/${s.n} | retried ${s.retried} | false claims ${s.falseClaims} | critical ${s.critical} | median ${(s.medianMs / 1000).toFixed(1)}s | ${money(s.cost)}`;
    return `${title} (${cases.length})\n  today:  ${f(m)}\n  direct: ${f(d)}\n  direct better ${better} / worse ${worse} / tie ${tie}`;
  };
  console.log("\n===== SUMMARY (safe to paste: no customer details) =====");
  console.log(`Saved agent model settings: ${JSON.stringify(store.agentModel)}`);
  console.log(line("All requests", store.cases));
  for (const k of order) console.log(line(KIND_LABEL[k], store.cases.filter(c => c.kind === k)));
  const sms = store.cases.filter(c => c.kind === "sms").map(c => c.arms.direct.calls[0]?.usage).filter(Boolean) as Usage[];
  console.log(`SMS cache, direct, in order: ${sms.map((u, i) => `#${i + 1} write1h ${u.write1h} write5m ${u.write5m} read ${u.cacheRead} input ${u.input}`).join(" | ")}`);
  console.log(`SMS instruction versions in the last ${store.smsScanned} production SMS requests: ${store.smsDistinctInstructions}`);
  if (store.ttlCheck) console.log(`Cache after ${store.ttlCheck.minutesAfterLastSms.toFixed(1)} min quiet: read ${store.ttlCheck.usage.cacheRead}, write1h ${store.ttlCheck.usage.write1h}, input ${store.ttlCheck.usage.input}${store.ttlCheck.error ? ` (${store.ttlCheck.error})` : ""}`);
  const m = summary(store.cases, "managed"), d = summary(store.cases, "direct");
  console.log(`Tokens today:  ${tok(m.usage)}\nTokens direct: ${tok(d.usage)}`);
  console.log(`Meaningful differences: ${store.cases.filter(c => differences(c).length).length} | notes: ${store.notes.join("; ") || "none"}`);
  console.log(`Test spend ${money(spent())}${store.stoppedForBudget ? " (stopped at the spending stop)" : ""} | Report: ${reportPath}`);
  rl.close(); process.exit(0);
}
main().catch(e => { console.error(`\n${String(e?.message ?? e)}`); rl.close(); process.exit(1); });
