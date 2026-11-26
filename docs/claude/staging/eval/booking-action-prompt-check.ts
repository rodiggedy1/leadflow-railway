/**
 * ONE-TIME PROMPT CHECK (not an app feature) for the Phase 1 booking-change paragraph. Run on the owner's Mac from
 * branch claude/booking-actions:   pnpm exec tsx docs/claude/staging/eval/booking-action-prompt-check.ts
 *  - Reads up to 10 recent production automatic-SMS requests from the saved agent's session history (read-only):
 *    up to 6 that mention moving/rescheduling/cancelling, the rest ordinary.
 *  - Sends each once with the NEW SMS instructions (this branch's paragraph added to the exact production
 *    instructions), on the same direct Messages API connection, model and 1-hour cache production uses.
 *  - Checks every reply with the production SMS checks and reports whether Claude added a booking change, and
 *    whether it is valid and grounded in the customer's message.
 * Nothing is sent to customers; no task is created; nothing is written to a database. Only api.anthropic.com is
 * contacted. Stops at $1 (expected about $0.15-0.30). Output stays on this Mac: ~/leadflow-booking-action-check/
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";

const OUT_DIR = process.env.EVAL_OUT_DIR ?? path.join(os.homedir(), "leadflow-booking-action-check");
const MOCK_ORIGIN = process.env.EVAL_ANTHROPIC_ORIGIN; // tests only
const SMS_PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===", STOP_DOLLARS = 1, MAX_SCANNED = 3000;
const CHANGE_WORDS = /resched|re-sched|\bmove\b|\bmoved\b|postpone|push (it|back)|another day|different (day|time|date)|cancel|\bskip\b|change (the|my) (date|day|time)/i;
const PRICE = { in: 2, out: 10, read: 0.1, write1h: 4, write5m: 2.5 };

for (const name of ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID"]) delete process.env[name];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin !== "https://api.anthropic.com") throw new Error(`EVAL_BLOCKED_HOST ${url.host}`);
  if (!MOCK_ORIGIN) return realFetch(input, init);
  const target = new URL(url.pathname + url.search, MOCK_ORIGIN);
  return typeof input === "string" || input instanceof URL ? realFetch(target, init) : realFetch(new Request(target, input), init);
}) as typeof fetch;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const writeOut = (rl as any)._writeToOutput?.bind(rl);
(rl as any)._writeToOutput = (s: string) => { if (!muted && writeOut) writeOut(s); };
const lines = rl[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  process.stdout.write(question); muted = true;
  const { value } = await lines.next(); muted = false; process.stdout.write("\n");
  return String(value ?? "").trim();
}

let KEY = "";
let prod: Awaited<ReturnType<typeof load>>;
async function load() {
  return {
    client: await import("../../../../server/instinct/claudeAgentClient"),
    sms: await import("../../../../server/instinct/smsBookingQuoteGeneration"),
    gen: await import("../../../../server/instinct/claudeCustomerSmsGeneration"),
    quote: await import("../../../../server/instinct/smsBookingQuote"),
    tasks: await import("../../../../shared/claudeCustomerTasks"),
    actions: await import("../../../../shared/claudeBookingActions"),
  };
}
async function api(p: string): Promise<any> {
  const r = await fetch(`https://api.anthropic.com${p}`, { headers: { "x-api-key": KEY, "anthropic-version": prod.client.ANTHROPIC_VERSION,
    "anthropic-beta": prod.client.ANTHROPIC_BETA, accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP_${r.status} ${p.split("?")[0].split("/").slice(0, 3).join("/")}`);
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
async function firstUserText(sessionId: string): Promise<string | null> {
  for await (const ev of paged(`/v1/sessions/${sessionId}/events`))
    if (ev.type === "user.message") return (ev.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return null;
}

/** The production SMS checks (same order as the app). Returns the parsed task for inspection. */
function check(text: string, payload: any, receivedAt: number): { ok: boolean; task?: any; error?: string } {
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
      const current = turns.filter(turn => turn && ["user", "customer"].includes(String(turn.role))).at(-1);
      if (current) current.opMsgId = "eval";
      prod.quote.advanceSmsBookingQuote(previous, parsed.bookingQuote, { binding: binding as any, originalConversation: turns, nowMs: receivedAt });
      prod.quote.assertSmsBookingQuoteModelText(plan.replyText);
    }
    return { ok: true, task: parsed.task };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).split("\n")[0].slice(0, 160) }; }
}

async function main() {
  console.log("LeadFlow one-time check: the Phase 1 booking-change prompt paragraph on recent automatic SMS requests.");
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  KEY = await ask("Paste the Anthropic API key for this check (hidden), then press Enter: ");
  if (!KEY) throw new Error("STOP: no API key entered.");
  process.env.ANTHROPIC_API_KEY = KEY;
  prod = await load();
  const paragraph = prod.sms.SMS_HISTORY_AND_RECORDS_INSTRUCTIONS;
  const cut = paragraph.indexOf("\nBOOKING ACTION (optional, inside task)");
  if (cut < 0) throw new Error("STOP: run this from branch claude/booking-actions.");
  const previousParagraph = paragraph.slice(0, cut);

  console.log("Reading recent production SMS requests (read-only)...");
  const change: any[] = [], other: any[] = [], seen = new Set<string>();
  let scanned = 0;
  for await (const s of paged("/v1/sessions?order=desc")) {
    if (++scanned > MAX_SCANNED || (change.length >= 6 && other.length >= 4)) break;
    const detail = s?.agent?.system !== undefined ? s : await api(`/v1/sessions/${s.id}`);
    const system = detail?.agent?.system;
    if (detail?.agent?.id !== prod.client.EXISTING_AGENT_ID || typeof system !== "string" || !system.startsWith(SMS_PREFIX) || !system.includes(previousParagraph)) continue;
    const userText = await firstUserText(detail.id);
    if (!userText || seen.has(userText)) continue;
    seen.add(userText);
    let payload: any; try { payload = JSON.parse(userText); } catch { continue; }
    const bucket = CHANGE_WORDS.test(String(payload.incomingMessage ?? "")) ? change : other;
    if (bucket.length < (bucket === change ? 6 : 4)) bucket.push({ system, userText, payload, created: Date.parse(detail.created_at) });
  }
  const chosen = [...change, ...other];
  console.log(`Scanned ${scanned} sessions: ${change.length} change-like and ${other.length} other SMS requests.`);
  if (!chosen.length) throw new Error("STOP: no recent production SMS requests were found.");

  const usage = { input: 0, output: 0, read: 0, write1h: 0, write5m: 0 };
  const realInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (!line.startsWith("[claude-usage] ")) return realInfo(...args);
    const u = JSON.parse(line.slice(15));
    usage.input += u.inputTokens; usage.output += u.outputTokens; usage.read += u.cacheReadTokens; usage.write1h += u.cacheCreation1hTokens; usage.write5m += u.cacheCreation5mTokens;
  };
  const spent = () => (usage.input * PRICE.in + usage.output * PRICE.out + usage.read * PRICE.read + usage.write1h * PRICE.write1h + usage.write5m * PRICE.write5m) / 1e6;
  const results: any[] = [];
  for (const [index, item] of chosen.entries()) {
    if (spent() >= STOP_DOLLARS) { console.log("Stopped at the $1 spending stop."); break; }
    const system = item.system.replace(previousParagraph, paragraph);
    let text: string | null = null, error: string | undefined;
    try { text = (await prod.client.runInitialLeadDraftOn("messages_api", { systemPrompt: system, userPrompt: item.userText, cacheTtl: "1h" })).finalSmsText; }
    catch (e: any) { error = String(e?.code ?? e?.message ?? e); }
    const checked = text ? check(text, item.payload, item.created) : { ok: false, error };
    const raw = checked.task?.bookingAction;
    const proposal = raw === undefined ? null : prod.actions.modelBookingActionSchema.safeParse(raw);
    const grounded = proposal?.success ? String(item.payload.incomingMessage ?? "").includes(proposal.data.evidenceQuote) : false;
    const row = { n: index + 1, changeLike: index < change.length, replyPassedChecks: checked.ok, error: checked.ok ? null : checked.error,
      task: checked.ok ? Boolean(checked.task) : null,
      bookingAction: raw === undefined ? "none" : proposal?.success ? (grounded ? `valid ${proposal.data.type}` : "valid but quote not in message (dropped)") : "malformed (dropped)",
      incomingMessage: item.payload.incomingMessage, output: text };
    results.push(row);
    console.log(`#${row.n} ${row.changeLike ? "change-like" : "other      "} | reply ${row.replyPassedChecks ? "passed checks" : `FAILED (${row.error})`} | task ${row.task ? "yes" : "no"} | bookingAction ${row.bookingAction}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 1), { mode: 0o600 });
  console.log("\n===== SUMMARY (safe to paste: no customer details) =====");
  console.log(`Requests ${results.length} | replies passed production checks ${results.filter(r => r.replyPassedChecks).length}/${results.length}`);
  console.log(`Change-like: ${results.filter(r => r.changeLike).map(r => r.bookingAction).join(" | ") || "none"}`);
  console.log(`Other:       ${results.filter(r => !r.changeLike).map(r => r.bookingAction).join(" | ") || "none"}`);
  console.log(`Tokens: input ${usage.input}, cache read ${usage.read}, cache write 1h ${usage.write1h}, output ${usage.output} | spend $${spent().toFixed(4)}`);
  console.log(`Details (contain customer messages, keep on this Mac): ${path.join(OUT_DIR, "results.json")}`);
  rl.close(); process.exit(0);
}
main().catch(e => { console.error(`\n${String(e?.message ?? e)}`); rl.close(); process.exit(1); });
