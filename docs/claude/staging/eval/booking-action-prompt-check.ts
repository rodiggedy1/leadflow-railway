/**
 * ONE-TIME PROMPT CHECK (not an app feature) for the Phase 1 booking-change paragraph, version 2. Run on the owner's
 * Mac inside a checkout of the release candidate (branch claude/booking-actions):
 *     pnpm exec tsx docs/claude/staging/eval/booking-action-prompt-check.ts
 *
 * Part 1 - the reply that failed in the first run. Reads the first run's results (~/leadflow-booking-action-check/
 *   results.json, kept on this Mac), finds those same earlier SMS requests in the saved agent's history (read-only), and
 *   sends each with the EXISTING instructions and with the NEW ones, each with production's one automatic retry.
 * Part 2 - realistic synthetic customers (invented names, 555-01xx numbers, no real data): clear reschedules, clear
 *   cancellations, ambiguous requests, single visits of weekly customers, and ordinary messages. Each goes through
 *   production's own SMS reply generator (same request, system prompt, knowledge, validation and retry) with invented
 *   saved bookings built by production's own booking-context code, then through production's own proposal check
 *   (attachProposedBookingAction). The existing instructions are run where a comparison is needed.
 * Nothing is sent to customers; no task is created; nothing is written to any database. Only api.anthropic.com is
 * contacted. Spending stops before $0.30 for this run. Output stays on this Mac: ~/leadflow-booking-action-check/
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";

const OUT_DIR = process.env.EVAL_OUT_DIR ?? path.join(os.homedir(), "leadflow-booking-action-check");
const MOCK_ORIGIN = process.env.EVAL_ANTHROPIC_ORIGIN; // tests only
const SMS_PREFIX = "=== SMS BOOKING QUOTE — HIGHEST PRIORITY ===", MAX_SCANNED = 3000;
const BUDGET = 0.30; // this run only
const PRICE = { in: 2, out: 10, read: 0.1, write1h: 4, write5m: 2.5 }; // claude-sonnet-5-5, $ per million tokens
const CACHE_TTL = "5m" as const; // the cache length does not change replies; 5 minutes keeps this run cheap

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
    records: await import("../../../../server/instinct/smsCustomerRecords"),
    voice: await import("../../../../server/instinct/voiceCustomerBookingContext"),
    actions: await import("../../../../server/instinct/claudeBookingActions"),
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
/** Error CODES only (never message text, which can quote a reply and so a customer's details). */
function errorCode(e: any): string {
  if (Array.isArray(e?.issues)) return `SCHEMA(${e.issues.slice(0, 4).map((i: any) => `${(i.path ?? []).join(".") || "root"}:${i.code}`).join(",")})`;
  return codeOf(String(e?.code ?? e?.message ?? e ?? ""), e?.name);
}
function codeOf(text: string, name?: string): string {
  const first = text.split("\n")[0].trim();
  if (/^[A-Z][A-Z0-9_]{2,}\b/.test(first)) return first.match(/^[A-Z][A-Z0-9_]{2,}/)![0];
  if (/JSON|Unexpected token|Unexpected end/i.test(first)) return "INVALID_JSON";
  if (first.startsWith("[") && /"code"\s*:/.test(first)) return `SCHEMA(${Array.from(first.matchAll(/"code"\s*:\s*"([a-z_]+)"/g)).slice(0, 4).map(m => m[1]).join(",")})`;
  return name && name !== "Error" ? name : "OTHER_ERROR";
}

/** The production SMS checks on a saved request's raw reply (same order as the app), as in the first run. */
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
  } catch (e: any) { return { ok: false, error: errorCode(e) }; }
}

// ───────────── spending (from the app's own [claude-usage] line, one per request) ─────────────
const usage = { input: 0, output: 0, read: 0, write1h: 0, write5m: 0, requests: 0 };
let systemTokens = 16_000; // replaced by the measured size after the first request
const spent = () => (usage.input * PRICE.in + usage.output * PRICE.out + usage.read * PRICE.read + usage.write1h * PRICE.write1h + usage.write5m * PRICE.write5m) / 1e6;
const warm = new Set<string>();
const estimate = (variant: string) => ((warm.has(variant) ? systemTokens * PRICE.read : systemTokens * PRICE.write5m) + 5_000 * PRICE.in + 1_000 * PRICE.out) / 1e6;
/** Room for one request plus production's possible automatic retry (the retry is warm). */
const affordable = (variant: string, limit = BUDGET) => spent() + estimate(variant) + (5_000 * PRICE.in + 1_000 * PRICE.out + systemTokens * PRICE.read) / 1e6 <= limit;

// ───────────── existing vs new instructions ─────────────
let PARAGRAPH = "";
const withoutParagraph = (system: string) => {
  const result = system.replace(PARAGRAPH, "");
  if (result === system) throw new Error("STOP: the booking-change paragraph was not found in the system prompt.");
  return result;
};
type Variant = "new" | "existing";
const runner = (variant: Variant) => async (req: any) => {
  const systemPrompt = variant === "new" ? req.systemPrompt : withoutParagraph(req.systemPrompt);
  const out = await prod.client.runInitialLeadDraftOn("messages_api", { ...req, systemPrompt, cacheTtl: CACHE_TTL });
  warm.add(variant);
  return out;
};

// ───────────── synthetic customers (invented) ─────────────
const NOW = Date.now();
const easternDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const TODAY = easternDate(NOW);
const day = (n: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const label = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${d}T12:00:00Z`));
const labelEs = (d: string) => new Intl.DateTimeFormat("es-US", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00Z`));
const weekday = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${d}T12:00:00Z`));
const ordinal = (d: string) => { const n = Number(d.slice(8)); return `${n}${[11, 12, 13].includes(n) ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`; };

type Expect = null | { type: "reschedule_visit" | "cancel_visit"; visitDate: string; newDate?: string | null; newTime?: string | null };
type Case = { key: string; group: string; name: string; message: string; jobs: Array<[number, string, string]>; past?: string; prior?: string; expect: Expect; note: string };
const T = (n: number) => day(n);
const CASES: Case[] = [
  { key: "R1", group: "clear reschedule", name: "Jordan Ellis", jobs: [[0, T(4), "10:00"]], note: "one-time visit, new date given, same time",
    message: `Hi! Something came up, can we move my cleaning on ${label(T(4))} to ${label(T(7))}? Same time works.`, expect: { type: "reschedule_visit", visitDate: T(4), newDate: T(7), newTime: null } },
  { key: "O1", group: "ordinary", name: "Priya Shah", jobs: [[0, T(3), "11:00"]], note: "question, upcoming visit",
    message: "Do you guys bring your own supplies and vacuum, or should I leave mine out?", expect: null },
  { key: "C1", group: "clear cancellation", name: "Marcus Reed", jobs: [[0, T(5), "09:00"]], note: "one-time visit",
    message: `Please cancel my cleaning on ${label(T(5))}, we'll be out of town. Sorry for the late notice!`, expect: { type: "cancel_visit", visitDate: T(5) } },
  { key: "A1", group: "ambiguous", name: "Elena Torres", jobs: [[0, T(3), "13:00"]], note: "no day chosen",
    message: "Is there any chance we could do a different day next week instead?", expect: null },
  { key: "W1", group: "one visit of a weekly customer", name: "Carla Nguyen", jobs: [[0, T(2), "09:00"], [1, T(9), "09:00"]], note: "skip the second weekly visit (not the next one)",
    message: `Can we skip the cleaning on ${label(T(9))}? Everything else stays the same.`, expect: { type: "cancel_visit", visitDate: T(9) } },
  { key: "W3", group: "one visit of a weekly customer", name: "Tom Becker", jobs: [[0, T(2), "09:00"], [1, T(9), "09:00"]], note: "ALL future visits: must stay manual",
    message: "Please cancel all my future cleanings, we're moving out of the area.", expect: null },
  { key: "O2", group: "ordinary", name: "Dev Patel", jobs: [], past: T(-2), note: "thanks after a completed visit",
    message: "Thank you so much, the house looks amazing! 😊", expect: null },
  { key: "R2", group: "clear reschedule", name: "Sam Brooks", jobs: [[0, T(1), "13:00"]], prior: `Hi Sam! Just a reminder your cleaning is tomorrow at 1:00 PM ✨`, note: "tomorrow's visit, new day and time",
    message: `Could we push tomorrow's cleaning to ${weekday(T(3))} at 2pm instead?`, expect: { type: "reschedule_visit", visitDate: T(1), newDate: T(3), newTime: "14:00" } },
  { key: "A2", group: "ambiguous", name: "Nina Hall", jobs: [[0, T(6), "10:00"]], note: "may cancel, not decided",
    message: "I might need to cancel, I'll let you know tomorrow.", expect: null },
  { key: "W2", group: "one visit of a weekly customer", name: "Omar Diaz", jobs: [[0, T(2), "09:00"], [1, T(9), "09:00"]], note: "move one later weekly visit by a day",
    message: `For the ${ordinal(T(9))} cleaning, could you come on ${label(T(10))} instead? Just that one week.`, expect: { type: "reschedule_visit", visitDate: T(9), newDate: T(10) } },
  { key: "C2", group: "clear cancellation", name: "Lucia Romero", jobs: [[0, T(6), "11:00"]], note: "Spanish",
    message: `Hola, necesito cancelar la limpieza del ${labelEs(T(6))}. Gracias.`, expect: { type: "cancel_visit", visitDate: T(6) } },
  { key: "A3", group: "ambiguous", name: "Grace Kim", jobs: [], note: "no saved booking at all",
    message: "Can you move my cleaning to next Friday?", expect: null },
  { key: "O3", group: "ordinary", name: "Aisha Bello", jobs: [], note: "new booking request (quote flow)",
    message: "Hi, I'd like to book a deep clean for my 3 bedroom 2 bath house next week. How much would it be?", expect: null },
  { key: "W4", group: "one visit of a weekly customer", name: "Ben Ortiz", jobs: [[0, T(2), "09:00"], [1, T(9), "09:00"]], note: "change the whole pattern: must stay manual",
    message: `Can we switch our regular cleanings from ${weekday(T(2))}s to ${weekday(T(3))}s going forward?`, expect: null },
];

function caseInput(c: Case, index: number) {
  const phone = `+1202555${String(150 + index).padStart(4, "0")}`;
  const providerMessageId = `ACsynthetic${index}`;
  const binding = { sessionId: 990_000 + index, providerMessageId, fromPhone: phone, receivingPhoneNumberId: "PNsynthetic", receivingPhoneNumber: "+12025550100",
    inboundText: c.message, createdAt: NOW, receivedAt: NOW, customerName: c.name, historyHash: "synthetic" };
  const originalConversation = [
    ...(c.prior ? [{ role: "assistant", content: c.prior, ts: NOW - 20 * 3_600_000, senderName: "Maids in Black" }] : []),
    { role: "user", content: c.message, ts: NOW, opMsgId: providerMessageId },
  ];
  const record = (id: number, date: string, time: string, status: string) => ({ source: "leadflow_job" as const, id, bookingId: null, customerName: c.name, customerPhone: phone,
    date, serviceDateTime: `${date} ${time}`, serviceName: "Standard Cleaning", address: "1420 Example St NW, Washington, DC", teamName: "Team Blue", status });
  const bookings = [...c.jobs.map(([n, date, time]) => record(index * 10 + n + 1, date, time, "Assigned")),
    ...(c.past ? [record(index * 10 + 9, c.past, "10:00", "Completed")] : [])];
  const bookingContext = prod.records.modelBookingContext(prod.voice.projectVoiceCustomerBookingContext({ phone, bookings, contacts: [], now: new Date(NOW) }));
  return {
    input: { incomingMessage: c.message, context: { binding, contact: { displayName: c.name, phone }, originalConversation,
      receivingPhoneNumberId: binding.receivingPhoneNumberId, receivingPhoneNumber: binding.receivingPhoneNumber, bookingContext: null },
      protectedIds: [providerMessageId, binding.receivingPhoneNumberId] },
    records: { openStaffTasks: [], bookingContext, unavailableRecords: [] as Array<"openStaffTasks" | "bookings"> },
  };
}
const generatorFor = (variant: Variant, records: any, capture?: (system: string) => void) => prod.sms.createSmsBookingQuoteReplyGenerator({
  runner: capture ? async (req: any) => { capture(req.systemPrompt); throw new Error("EVAL_CAPTURED"); } : runner(variant),
  smsBookingQuote: { readState: async () => null }, readCustomerRecords: async () => records,
} as any);

const CLAIMS_DONE = /\b(has|have) been (moved|rescheduled|cancel+ed)\b|\b(we've|we have|i've|i have) (moved|rescheduled|cancel+ed)\b|\bis now (moved|rescheduled|cancel+ed)\b|\ball set\b|\bis (cancel+ed|rescheduled)\b/i;
const describe = (r: any) => r ? `${r.type === "reschedule_visit" ? "reschedule" : "cancel"} ${r.visitDate}${r.newDate ? ` -> ${r.newDate}` : ""}${r.newTime ? ` ${r.newTime}` : ""}` : "none";
const expected = (e: Expect) => e ? describe({ newDate: null, newTime: null, ...e }) : "none";

async function runCase(c: Case, index: number, variant: Variant) {
  const { input, records } = caseInput(c, index);
  const before = usage.requests;
  let plan: any = null, error: string | null = null;
  try { plan = await generatorFor(variant, records)(input as any); } catch (e) { error = errorCode(e); }
  const raw = plan?.task?.bookingAction;
  let accepted: any = null;
  if (plan?.task && raw !== undefined) {
    // Production's own proposal check, with a stand-in for the database insert (nothing is written anywhere).
    const tx = { insert: () => ({ values: async (row: any) => { accepted = JSON.parse(row.metadata).request; } }) };
    await prod.actions.attachProposedBookingAction(tx as any, { id: 1, items: plan.task.items.map((item: any, i: number) => ({ id: `item-${i + 1}`, evidenceQuote: item.evidenceQuote })) }, raw, c.message);
  }
  const e = c.expect;
  const match = !error && (e === null ? accepted === null : Boolean(accepted && accepted.type === e.type && accepted.visitDate === e.visitDate
    && (e.newDate === undefined || accepted.newDate === e.newDate) && (e.newTime === undefined || accepted.newTime === e.newTime)));
  return { key: c.key, group: c.group, variant, note: c.note, message: c.message, requests: usage.requests - before,
    replyPassed: !error, error, task: plan ? Boolean(plan.task) : null, proposedByClaude: raw === undefined ? false : true,
    accepted: describe(accepted), expected: expected(e), match, claimsDone: plan ? CLAIMS_DONE.test(String(plan.replyText)) : null,
    reply: plan?.replyText ?? null, quoteFlow: Boolean(plan?.smsBookingQuote) };
}

async function main() {
  console.log("LeadFlow prompt check v2: the Phase 1 booking-change paragraph (existing vs new SMS instructions).");
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  KEY = await ask("Paste the Anthropic API key for this check (hidden), then press Enter: ");
  if (!KEY) throw new Error("STOP: no API key entered.");
  process.env.ANTHROPIC_API_KEY = KEY;
  prod = await load();
  const records = prod.sms.SMS_HISTORY_AND_RECORDS_INSTRUCTIONS;
  const cut = records.indexOf("\nBOOKING ACTION (optional, inside task)");
  if (cut < 0) throw new Error("STOP: run this from the release candidate (branch claude/booking-actions).");
  PARAGRAPH = records.slice(cut);
  const realInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (!line.startsWith("[claude-usage] ")) return realInfo(...args);
    const u = JSON.parse(line.slice(15));
    usage.input += u.inputTokens; usage.output += u.outputTokens; usage.read += u.cacheReadTokens; usage.write1h += u.cacheCreation1hTokens; usage.write5m += u.cacheCreation5mTokens;
    usage.requests++;
    const cached = Number(u.cacheReadTokens) + Number(u.cacheCreation1hTokens) + Number(u.cacheCreation5mTokens);
    if (cached > 1000) systemTokens = cached;
  };

  // The exact system prompt production builds today (captured without calling the API).
  let NEW_SYSTEM = "";
  try { await generatorFor("new", caseInput(CASES[0], 0).records, system => { NEW_SYSTEM = system; })(caseInput(CASES[0], 0).input as any); } catch { /* captured */ }
  if (!NEW_SYSTEM.includes(PARAGRAPH)) throw new Error("STOP: could not build the production SMS system prompt.");

  // ── Part 1: the reply that failed in the first run ──
  const investigation: any[] = [];
  const previousFile = path.join(OUT_DIR, "results.json");
  const failed = fs.existsSync(previousFile) ? (JSON.parse(fs.readFileSync(previousFile, "utf8")) as any[]).filter(r => r && r.replyPassedChecks === false) : [];
  const found: Array<{ n: number; error: string; userText: string; payload: any; created: number; sameSystem: boolean }> = [];
  if (failed.length) {
    console.log(`\nPart 1: ${failed.length} reply(ies) failed in the first run (${failed.map(r => `#${r.n}: ${codeOf(String(r.error ?? ""))}`).join("; ")}). Finding the same request(s)...`);
    const wanted = new Map(failed.map(r => [String(r.incomingMessage), r]));
    let scanned = 0;
    for await (const s of paged("/v1/sessions?order=desc")) {
      if (++scanned > MAX_SCANNED || found.length === wanted.size) break;
      const detail = s?.agent?.system !== undefined ? s : await api(`/v1/sessions/${s.id}`);
      const system = detail?.agent?.system;
      if (detail?.agent?.id !== prod.client.EXISTING_AGENT_ID || typeof system !== "string" || !system.startsWith(SMS_PREFIX)) continue;
      const userText = await firstUserText(detail.id);
      let payload: any; try { payload = JSON.parse(userText ?? ""); } catch { continue; }
      const row = wanted.get(String(payload.incomingMessage));
      if (!row || found.some(f => f.n === row.n)) continue;
      found.push({ n: row.n, error: codeOf(String(row.error ?? "")), userText: userText!, payload, created: Date.parse(detail.created_at),
        sameSystem: system === NEW_SYSTEM.replace(PARAGRAPH, "") || system === NEW_SYSTEM });
    }
    if (!found.length) console.log("  The earlier request could not be found again; Part 1 is skipped.");
  }
  async function historical(item: (typeof found)[number], variant: Variant) {
    const systemPrompt = variant === "new" ? NEW_SYSTEM : withoutParagraph(NEW_SYSTEM);
    const attempts: Array<{ ok: boolean; error?: string; bookingAction?: boolean }> = [];
    for (let attempt = 0; attempt < 2; attempt++) { // production retries once after a failed check
      let text: string | null = null, error: string | undefined;
      try { text = (await prod.client.runInitialLeadDraftOn("messages_api", { systemPrompt, userPrompt: item.userText, cacheTtl: CACHE_TTL })).finalSmsText; warm.add(variant); }
      catch (e) { error = errorCode(e); }
      const checked = text ? check(text, item.payload, item.created) : { ok: false, error };
      attempts.push({ ok: checked.ok, error: checked.ok ? undefined : checked.error, bookingAction: checked.task?.bookingAction !== undefined });
      if (checked.ok) break;
    }
    return attempts;
  }
  const say = (a: Array<{ ok: boolean; error?: string }>) => a[0].ok ? "passed" : a[1]?.ok ? `failed first (${a[0].error}), passed on production's automatic retry`
    : `failed both tries (${a.map(x => x.error).join(" / ")})`;
  const results: any[] = [];
  // Keeps room for Part 1 with the existing instructions and for comparing the cases that need it.
  const reserve = (found.length ? 0.06 : 0) + 0.03;
  for (const item of found) {
    if (!affordable("new")) break;
    const attempts = await historical(item, "new");
    investigation.push({ n: item.n, variant: "new", firstRunError: item.error, attempts });
    console.log(`#${item.n} (first run: ${item.error}) with NEW instructions: ${say(attempts)}`);
  }

  // ── Part 2: synthetic customers, new instructions ──
  console.log(`\nPart 2: ${CASES.length} synthetic customers with the NEW instructions (dates relative to today, ${TODAY}).`);
  for (const [index, c] of CASES.entries()) {
    if (!affordable("new", BUDGET - reserve)) { console.log(`Stopped before ${c.key} to stay under $${BUDGET.toFixed(2)}.`); break; }
    const r = await runCase(c, index, "new");
    results.push(r);
    console.log(`${r.key.padEnd(3)} ${r.group.padEnd(31)} | reply ${r.replyPassed ? "passed checks" : `FAILED (${r.error})`} | proposal ${r.accepted.padEnd(32)} | expected ${r.expected.padEnd(32)} | ${r.match ? "OK" : "MISMATCH"}${r.claimsDone ? " | REPLY MAY CLAIM IT'S DONE" : ""}`);
  }

  // ── Existing instructions: Part 1's request, then synthetic customers where a comparison is needed ──
  for (const item of found) {
    if (!affordable("existing")) break;
    const attempts = await historical(item, "existing");
    investigation.push({ n: item.n, variant: "existing", firstRunError: item.error, attempts });
    console.log(`\n#${item.n} with EXISTING instructions (as in production today): ${say(attempts)}`);
  }
  const needed = results.filter(r => !r.replyPassed || r.claimsDone || (!r.match && r.expected === "none"));
  const baseline = ["R1", "O1"].map(key => results.find(r => r.key === key)).filter(Boolean);
  const compare = [...needed, ...baseline.filter(r => !needed.includes(r))];
  if (compare.length) console.log(`\nComparison with the EXISTING instructions (${compare.map(r => r.key).join(", ")}):`);
  for (const r of compare) {
    if (!affordable("existing")) { console.log(`Stopped before ${r.key} to stay under $${BUDGET.toFixed(2)}.`); break; }
    const index = CASES.findIndex(c => c.key === r.key);
    const old = await runCase(CASES[index], index, "existing");
    results.push(old);
    console.log(`${old.key.padEnd(3)} EXISTING | reply ${old.replyPassed ? "passed checks" : `FAILED (${old.error})`} | proposal ${old.accepted}${old.claimsDone ? " | REPLY MAY CLAIM IT'S DONE" : ""}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "results-v2.json"), JSON.stringify({ investigation, results }, null, 1), { mode: 0o600 });
  const fresh = results.filter(r => r.variant === "new");
  const groups = Array.from(new Set(CASES.map(c => c.group)));
  console.log("\n===== SUMMARY (safe to paste: synthetic customers only; Part 1 shows error codes only) =====");
  for (const item of investigation) console.log(`Part 1 #${item.n} ${item.variant.padEnd(8)}: ${say(item.attempts)}`);
  if (found.length) console.log(`Part 1 system prompt today is the same as when that request ran: ${found.every(f => f.sameSystem) ? "yes" : "no (re-run uses today's)"}`);
  console.log(`Synthetic, NEW instructions: replies passed ${fresh.filter(r => r.replyPassed).length}/${fresh.length} | proposals as expected ${fresh.filter(r => r.match).length}/${fresh.length} | replies claiming the change is done ${fresh.filter(r => r.claimsDone).length}`);
  for (const g of groups) {
    const rows = fresh.filter(r => r.group === g);
    if (rows.length) console.log(`  ${g.padEnd(31)} ${rows.map(r => `${r.key}=${r.match ? "OK" : `MISMATCH(got ${r.accepted}, expected ${r.expected})`}`).join("  ")}`);
  }
  const olds = results.filter(r => r.variant === "existing");
  if (olds.length) console.log(`Synthetic, EXISTING instructions: ${olds.map(r => `${r.key}: reply ${r.replyPassed ? "passed" : `FAILED (${r.error})`}, proposal ${r.accepted}`).join(" | ")}`);
  console.log(`Requests ${usage.requests} | tokens: input ${usage.input}, cache read ${usage.read}, cache write ${usage.write5m + usage.write1h}, output ${usage.output} | spend $${spent().toFixed(4)} (limit $${BUDGET.toFixed(2)})`);
  console.log("\nSynthetic replies (invented customers):");
  for (const r of fresh) console.log(`  ${r.key}: ${r.reply ? String(r.reply).replace(/\s+/g, " ").slice(0, 220) : `(no reply: ${r.error})`}`);
  console.log(`\nDetails: ${path.join(OUT_DIR, "results-v2.json")}`);
  rl.close(); process.exit(0);
}
main().catch(e => { console.error(`\n${String(e?.message ?? e)}`); rl.close(); process.exit(1); });
