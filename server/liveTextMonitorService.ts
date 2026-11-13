import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { AuditCandidate, AuditExpectation, AuditItem, AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
import type { LiveTextAction, LiveTextCheck, LiveTextContext, LiveTextDecision, LiveTextFeed } from "../shared/liveTextMonitor";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "../shared/bookingWidgetConfig";
import { auditBusinessDate, isValidAuditDate, normalizeAuditPhone, normalizeAuditTime, verifyAuditCandidates } from "./dailyActionAuditEngine";
import { interpretAuditThreads } from "./dailyActionAuditInterpret";
import { readLeadFlowAuditRecords } from "./dailyActionAuditData";
import { readLiveTextContext, readLiveTextFeed } from "./liveTextMonitorData";
import { invokeLLM } from "./_core/llm";

const TIME_ZONE = "America/New_York";
const MESSAGE_CAP = 30;
const MESSAGE_BUDGET = 16_000;
const CACHE_TTL = 5 * 60_000;
const CACHE_CAP = 100;
type Interpretation = Awaited<ReturnType<typeof interpretAuditThreads>>;
type CacheEntry = { interpret: typeof interpretAuditThreads; model: typeof invokeLLM; promise: Promise<Interpretation>; expiresAt: number; pending: boolean };
/** Process-local interpretation only: never rows, record snapshots or verification decisions. */
export type LiveTextInterpretCache = Map<string, CacheEntry>;
export function createLiveTextInterpretCache(): LiveTextInterpretCache { return new Map(); }
const interpretationCache = createLiveTextInterpretCache();

export type LiveTextMonitorDependencies = {
  feed: () => Promise<LiveTextFeed>;
  context: (sessionId: number, messageKey: string) => Promise<LiveTextContext | null>;
  interpret: typeof interpretAuditThreads;
  model: typeof invokeLLM;
  records: typeof readLeadFlowAuditRecords;
  verify: typeof verifyAuditCandidates;
  now: () => Date;
  cache: LiveTextInterpretCache;
};
const defaults: LiveTextMonitorDependencies = {
  feed: readLiveTextFeed, context: readLiveTextContext, interpret: interpretAuditThreads,
  model: invokeLLM, records: readLeadFlowAuditRecords, verify: verifyAuditCandidates, now: () => new Date(), cache: interpretationCache,
};

/** Feed reads stored session texts only. Reading the page never invokes interpretation. */
export async function getLiveTextFeed(dependencies: Partial<LiveTextMonitorDependencies> = {}): Promise<LiveTextFeed> {
  const deps = { ...defaults, ...dependencies };
  try { return await deps.feed(); }
  catch { return { rows: [], checkedAt: deps.now().toISOString(), partial: true, unavailable: true, failure: "DB_READ_FAILED" }; }
}

function copyMessage(message: AuditMessage): AuditMessage { return { ...message }; }
function review(source: LiveTextContext, checkedAt: string, reason: string, conversation = source.messages): LiveTextCheck {
  return { rowKey: source.row.key, revision: source.row.revision, required: "review", verified: "review",
    summary: reason, evidence: reason, actions: [], conversation: conversation.map(copyMessage), checkedAt };
}
function messageDate(message: AuditMessage): string | null {
  // A trustworthy occurrence/history instant identifies its stored day; received
  // evidence uses observed time. Neither is upgraded to provider proof here.
  const occurrence = ["provider", "history"].includes(message.timeBasis)
    ? auditBusinessDate(message.occurredAt, TIME_ZONE) : null;
  return occurrence ?? auditBusinessDate(message.observedAt, TIME_ZONE);
}
function boundContext(source: LiveTextContext): { thread: AuditThread; omitted: boolean } | null {
  const target = source.row.message;
  const phone = normalizeAuditPhone(target.customerPhone);
  const matches = source.messages.filter(message => message.key === target.key);
  if (!phone || matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(target)) return null;
  const keys = new Set(source.messages.map(message => message.key));
  if (keys.size !== source.messages.length || source.messages.some(message => normalizeAuditPhone(message.customerPhone) !== phone
    || normalizeAuditPhone(message.businessPhone) !== normalizeAuditPhone(target.businessPhone)
    || message.sessionId !== source.row.sessionId)) return null;
  // Keep the entire exact target first, then nearest stored context in reader order.
  // Never clip a text or split this check into multiple model calls.
  const selected = new Set<string>();
  let used = 2; // Serialized array brackets, plus a comma between messages.
  const targetIndex = source.messages.findIndex(message => message.key === target.key);
  const prioritized = source.messages.map((message, index) => ({ message, index }))
    .sort((a, b) => Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex) || a.index - b.index);
  for (const { message } of prioritized) {
    const size = Buffer.byteLength(JSON.stringify(message), "utf8") + (selected.size ? 1 : 0);
    if (selected.size >= MESSAGE_CAP || used + size > MESSAGE_BUDGET) continue;
    selected.add(message.key); used += size;
  }
  if (!selected.has(target.key)) return null;
  const omitted = selected.size !== source.messages.length;
  return { omitted, thread: {
    key: `live-text-thread:${createHash("sha256").update(JSON.stringify([source.row.sessionId, phone])).digest("hex").slice(0, 24)}`,
    customerPhone: phone, customerName: null,
    messages: source.messages.filter(message => selected.has(message.key)).map(copyMessage),
    truncated: source.partial || omitted,
  } };
}

async function interpretOnce(source: LiveTextContext, thread: AuditThread, auditDate: string, deps: LiveTextMonitorDependencies): Promise<Interpretation> {
  // Full source metadata + all exact context + partial flag participates, even if
  // the bounded model window is identical. No phone/text from the client is used.
  const key = createHash("sha256").update(JSON.stringify({ row: source.row, messages: source.messages, partial: source.partial, auditDate, thread })).digest("hex");
  const now = deps.now().getTime();
  for (const [entryKey, entry] of Array.from(deps.cache)) {
    if (!entry.pending && entry.expiresAt <= now) deps.cache.delete(entryKey);
  }
  const existing = deps.cache.get(key);
  if (existing && existing.interpret === deps.interpret && existing.model === deps.model) return existing.promise;
  // An in-flight entry is never evicted/retried, including while the unchanged
  // interpreter waits for a transport timeout. Retain failed output for the TTL.
  if (existing?.pending) return { candidates: [], warnings: ["Checking is unavailable."], threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 0 };
  if (deps.cache.size >= CACHE_CAP) {
    const evictable = Array.from(deps.cache).find(([, entry]) => !entry.pending);
    if (!evictable) return { candidates: [], warnings: ["Checking is unavailable."], threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 0 };
    deps.cache.delete(evictable[0]);
  }
  const entry: CacheEntry = { interpret: deps.interpret, model: deps.model, promise: Promise.resolve({ candidates: [], warnings: [], threadsAnalyzed: 0 }), expiresAt: now + CACHE_TTL, pending: true };
  let callsInFlight = 0;
  let interpretationFinished = false;
  // Observe settlement only: same existing transport, exact same parameters,
  // no extra deadline, retry, cancellation, model or prompt change.
  const trackedModel: typeof invokeLLM = async params => {
    callsInFlight++;
    try { return await deps.model(params); }
    finally { callsInFlight--; entry.pending = !interpretationFinished || callsInFlight > 0; }
  };
  entry.promise = Promise.resolve().then(() => deps.interpret({ auditDate, timeZone: TIME_ZONE, threads: [thread], records: [], evidenceMode: "captured" }, trackedModel))
    .catch((): Interpretation => ({ candidates: [], warnings: ["Text analysis is unavailable."], threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 0 }))
    .then(result => { interpretationFinished = true; entry.pending = callsInFlight > 0; entry.expiresAt = deps.now().getTime() + CACHE_TTL; return result; });
  deps.cache.set(key, entry);
  return entry.promise;
}

function tidy(value: string): string { return value.trim().replace(/\s+/g, " "); }
function readableDate(value: string | null): string | null {
  return isValidAuditDate(value) ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00Z`)) : null;
}
function readableTime(value: string | null): string | null {
  const clock = normalizeAuditTime(value);
  return clock ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(`2000-01-01T${clock}:00Z`)) : null;
}
function amount(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function extraNames(values: string[]): string {
  return values.map(value => BOOKING_WIDGET_PRICED_EXTRAS.find(extra => extra.id === value)?.label ?? tidy(value)).join(", ");
}
function actionSummary(candidate: AuditCandidate): string {
  const expected = candidate.expected;
  const verbs = { reschedule: "Reschedule cleaning", cancel: "Cancel cleaning", book: "Book cleaning", address: "Update address", service: "Update service", assignment: "Update team", payment: "Check payment" };
  let result = verbs[candidate.action];
  const date = readableDate(expected.date), original = readableDate(expected.originalDate);
  if (original && candidate.action === "reschedule") result += ` from ${original}`;
  if (date) result += `${candidate.action === "reschedule" ? " to" : " on"} ${date}`;
  else if (["reschedule", "book"].includes(candidate.action)) result += " — date needs review";
  const time = readableTime(expected.time), end = readableTime(expected.windowEnd);
  if (expected.timeKind === "exact" && time) result += ` at ${time}`;
  if (expected.timeKind === "window" && time && end) result += `, ${time}–${end}`;
  if (candidate.action === "address" && expected.address) result += `: ${tidy(expected.address)}`;
  if (candidate.action === "service") {
    if (expected.serviceName) result += `: ${tidy(expected.serviceName)}`;
    if (expected.extras !== null) result += `; ${expected.extrasMode ?? "review"} ${extraNames(expected.extras) || "no extras"}`;
  }
  if (candidate.action === "assignment" && expected.teamName) result += `: ${tidy(expected.teamName)}`;
  if (candidate.action === "payment" && expected.amountCents !== null) result += `: ${amount(expected.amountCents)}`;
  return result;
}
function requestedFields(expected: AuditExpectation): string[] {
  const fields: string[] = [];
  if (expected.bookingReference) fields.push(`reference ${tidy(expected.bookingReference)}`);
  if (expected.originalDate) fields.push(`original date ${readableDate(expected.originalDate) ?? "unknown"}`);
  if (expected.date) fields.push(`date ${readableDate(expected.date) ?? "unknown"}`);
  if (expected.timeKind === "exact") fields.push(`time ${readableTime(expected.time) ?? "unknown"}`);
  if (expected.timeKind === "window") fields.push(`arrival ${readableTime(expected.time) ?? "unknown"}–${readableTime(expected.windowEnd) ?? "unknown"}`);
  if (expected.scope !== "unspecified") fields.push(`scope ${expected.scope === "visit" ? "this visit" : "subsequent visits"}`);
  if (expected.address !== null) fields.push(`address ${tidy(expected.address)}`);
  if (expected.serviceName !== null) fields.push(`service ${tidy(expected.serviceName)}`);
  if (expected.extras !== null) fields.push(`extras (${expected.extrasMode ?? "unspecified"}) ${extraNames(expected.extras) || "none"}`);
  if (expected.teamName !== null) fields.push(`team ${tidy(expected.teamName)}`);
  if (expected.amountCents !== null) fields.push(`amount ${amount(expected.amountCents)}`);
  return fields;
}
function currentFields(record: AuditRecord, candidate: AuditCandidate): string[] {
  const expected = candidate.expected;
  const fields: string[] = [];
  if (expected.date !== null || expected.originalDate !== null) fields.push(`date ${readableDate(record.date) ?? "unknown"}`);
  if (expected.timeKind !== "unspecified") fields.push(`time ${readableTime(record.time) ?? "unknown"}${record.timeZone !== TIME_ZONE ? " (timezone unverified)" : ""}`);
  if (expected.address !== null) fields.push(`address ${record.address ? tidy(record.address) : "unknown"}`);
  if (expected.serviceName !== null) fields.push(`service ${record.serviceName ? tidy(record.serviceName) : "unknown"}`);
  if (expected.extras !== null) fields.push(`extras ${record.extras === null ? "unknown" : extraNames(record.extras) || "none"}`);
  if (expected.teamName !== null) fields.push(`team ${record.teamName ? tidy(record.teamName) : "unknown"}`);
  if (candidate.action === "payment") {
    fields.push(`payment state ${record.paymentStatus ?? "unknown"}`);
    if (expected.amountCents !== null) fields.push(`paid amount ${record.paidAmountCents === null ? "unknown" : amount(record.paidAmountCents)}`);
  } else fields.push(`state ${record.status ? tidy(record.status) : "unknown"}`);
  return fields;
}
function decision(item: AuditItem): LiveTextDecision {
  return item.status === "matches" ? "yes" : ["needs_action", "conflict"].includes(item.status) ? "no" : "review";
}
/** Translate only known engine reasons; never return its concatenated warnings/prose. */
function shortReason(item: AuditItem): string {
  if (item.status === "matches") return "Current records match the specified request.";
  if (item.status === "superseded") return "A later verified correction needs review.";
  const reason = item.verification.split(" Captured evidence identifies the stored review day only;")[0];
  const reasons: Array<[RegExp, string]> = [
    [/different or invalid customer phone|different thread\/customer|cross-customer/i, "Record customer does not match this text."],
    [/Conflicting customer\/household|exact valid customer phone/i, "Customer identity needs review."],
    [/requires an explicit target calendar date|target date is malformed/i, "Requested date is unclear."],
    [/scheduled time differs/i, "Scheduled time differs from the request."],
    [/outside the requested arrival window/i, "Scheduled time is outside the requested window."],
    [/persisted date differs/i, "Scheduled date differs from the request."],
    [/paid amount differs/i, "Persisted paid amount differs from the request."],
    [/paymentStatus is not paid\/captured/i, "Current records do not show the requested captured payment."],
    [/not cancelled/i, "The visit is not cancelled in current records."],
    [/cancelled or awaiting booking approval|expired rather than active/i, "The visit is not active in current records."],
    [/extras do not satisfy/i, "Current extras differ from the request."],
    [/address differs/i, "Current address differs from the request."],
    [/service differs/i, "Current service differs from the request."],
    [/team differs/i, "Current team differs from the request."],
    [/Multiple bookings|Multiple operational|first versus later|recurring occurrence|series-wide/i, "The exact visit or recurrence scope needs review."],
    [/No matching persisted new booking/i, "No matching booking exists in current records."],
    [/No existing visit|No exact public reference|No current canonical/i, "No exact matching visit could be established."],
    [/ambiguous|low or invalid confidence|Declined\/unclear/i, "The requested action needs clarification."],
    [/time is unknown|timestamp|Anchor time|history\/observed date|after the supplied/i, "Text timing needs review."],
    [/outbound anchor|Confirmation is not established/i, "A sent outbound instruction is not verified."],
    [/payment|paid amount|requested amount/i, "Current records cannot verify payment and the exact amount."],
    [/timezone/i, "The scheduled timezone is not verified."],
    [/no valid exact scheduled local time/i, "The scheduled time is unknown."],
    [/no linked operational job|Only canonical booking preferences/i, "No operational visit verifies the schedule."],
  ];
  return reasons.find(([pattern]) => pattern.test(reason))?.[1]
    ?? (decision(item) === "no" ? "Current state differs from the specified request." : "Current evidence is insufficient to verify this action.");
}
function presentAction(candidate: AuditCandidate, item: AuditItem | undefined, override: string | null): LiveTextAction {
  const records = item?.records.map(record => ({ ...record, extras: record.extras ? [...record.extras] : null })) ?? [];
  const requested = requestedFields(candidate.expected);
  const evidence = [`Requested: ${requested.length ? requested.join("; ") : "details unclear"}.`];
  for (const record of records) {
    evidence.push(`${record.source === "bookings" ? "Booking" : "Job"} ${record.publicBookingNumber ? `${tidy(record.publicBookingNumber)} ` : ""}(${record.key}): ${currentFields(record, candidate).join("; ")}.`);
  }
  evidence.push(override ?? (item ? shortReason(item) : "Current evidence is insufficient to verify this action."));
  const explicitDate = candidate.expected.date ?? (candidate.action !== "reschedule" && candidate.action !== "book" ? candidate.expected.originalDate : null);
  const syncServiceDate = candidate.action !== "payment" && !candidate.ambiguous && candidate.confidence >= 0.8
    && !["unclear", "declined"].includes(candidate.agreement) && candidate.expected.scope !== "subsequent"
    && isValidAuditDate(explicitDate) ? explicitDate : null;
  return { id: candidate.id, type: candidate.action, summary: actionSummary(candidate),
    syncServiceDate,
    verified: override || !item ? "review" : decision(item), evidence: evidence.join(" "), records,
    links: item?.recordLinks.map(link => ({ ...link })) ?? [] };
}

/** Server-owned exact session text analysis. No durable state, daily scan, outbound action or retry. */
export async function checkLiveText(input: { sessionId: number; messageKey: string }, dependencies: Partial<LiveTextMonitorDependencies> = {}): Promise<LiveTextCheck> {
  if (!Number.isSafeInteger(input?.sessionId) || input.sessionId <= 0 || typeof input.messageKey !== "string"
    || !/^session-text:[a-f0-9]{64}$/.test(input.messageKey)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid captured text." });
  const deps = { ...defaults, ...dependencies };
  let loaded: LiveTextContext | null;
  try { loaded = await deps.context(input.sessionId, input.messageKey); }
  catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Captured text could not be read." }); }
  if (!loaded) throw new TRPCError({ code: "NOT_FOUND", message: "Captured text is unavailable." });
  // Take an immutable snapshot before awaiting the model: later reader revisions
  // must not change which text/result this response belongs to.
  let source: LiveTextContext;
  try {
    if (!loaded.row?.message || !Array.isArray(loaded.messages)) throw new Error();
    source = { row: { ...loaded.row, message: copyMessage(loaded.row.message) }, messages: loaded.messages.map(copyMessage), partial: loaded.partial };
    if (source.row.sessionId !== input.sessionId || source.row.key !== input.messageKey
      || source.row.message.key !== input.messageKey || source.row.message.sessionId !== input.sessionId
      || typeof source.row.revision !== "string" || !source.row.revision
      || typeof source.row.message.text !== "string" || !source.row.message.text.trim()) throw new Error();
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Captured text identity could not be verified." });
  }
  const checkedAt = deps.now().toISOString();
  if (source.row.identityAmbiguous) return review(source, checkedAt, "Customer identity needs review.");
  let bounded: ReturnType<typeof boundContext>;
  try { bounded = boundContext(source); }
  catch { return review(source, checkedAt, "Exact text context could not be verified.", [source.row.message]); }
  if (!bounded) return review(source, checkedAt, "Exact text context could not be verified.", [source.row.message]);
  const auditDate = messageDate(source.row.message);
  if (!auditDate) return review(source, checkedAt, "Text timing needs review.", bounded.thread.messages);
  const interpreted = await interpretOnce(source, bounded.thread, auditDate, deps);
  // Non-target actions may support a strictly referenced correction in the old
  // verifier, but are context-only and can never become this row's action.
  const candidates = interpreted.candidates.filter(candidate => candidate.threadKey === bounded.thread.key);
  const targets = candidates.filter(candidate => candidate.anchorMessageKey === source.row.message.key && !candidate.contextOnly);
  const verifiedAt = deps.now().toISOString();
  if (!targets.length) {
    const complete = interpreted.threadsAnalyzed === 1 && !(interpreted.failedThreads ?? 0) && !(interpreted.omittedMessages ?? 0)
      && !interpreted.warnings.length && !source.partial && !bounded.omitted
      && source.row.message.timeBasis !== "unknown"
      && (source.row.message.direction === "inbound" ? source.row.message.delivery === "received" : ["sent", "delivered"].includes(source.row.message.delivery));
    if (!complete) return review(source, verifiedAt, "Text analysis is incomplete; review this text.", bounded.thread.messages);
    return { rowKey: source.row.key, revision: source.row.revision, required: "no", verified: "not_applicable",
      summary: "No action required.", evidence: "No operational request or commitment was found in this text.", actions: [], conversation: bounded.thread.messages.map(copyMessage), checkedAt: verifiedAt };
  }
  let recordResult: Awaited<ReturnType<typeof readLeadFlowAuditRecords>>;
  let recordFailure = false;
  try { recordResult = await deps.records({ threads: [bounded.thread], candidates: targets }); }
  catch { recordFailure = true; recordResult = { records: [], warnings: [], truncated: true, incompleteThreadKeys: [bounded.thread.key] }; }
  const incomplete = recordFailure || recordResult.truncated || recordResult.incompleteThreadKeys.includes(bounded.thread.key);
  const exactNames = Array.from(new Set(recordResult.records.filter(record => normalizeAuditPhone(record.customerPhone) === bounded.thread.customerPhone)
    .map(record => record.customerName ? tidy(record.customerName) : null).filter((name): name is string => name !== null)));
  const thread = { ...bounded.thread, customerName: exactNames.length === 1 ? exactNames[0] : null };
  const verifierCandidates = candidates.map(candidate => candidate.anchorMessageKey === source.row.message.key ? { ...candidate }
    : { ...candidate, contextOnly: true });
  let items: AuditItem[] = [];
  let processingFailure = false;
  try { items = deps.verify({ auditDate, timeZone: TIME_ZONE, asOf: deps.now().toISOString(), threads: [thread], candidates: verifierCandidates, records: recordResult.records, evidenceMode: "captured" }); }
  catch { processingFailure = true; }
  const override = recordFailure ? "Current records are unavailable."
    : incomplete ? "Current record coverage is incomplete."
    : processingFailure ? "Current evidence could not be verified." : null;
  const actions = targets.map(candidate => presentAction(candidate, items.find(item => item.id === candidate.id), override));
  const required: LiveTextDecision = targets.some(candidate => candidate.ambiguous || candidate.confidence < 0.8 || ["unclear", "declined"].includes(candidate.agreement)) ? "review" : "yes";
  const verified: LiveTextDecision = actions.some(action => action.verified === "no") ? "no"
    : actions.some(action => action.verified === "review") ? "review" : "yes";
  return { rowKey: source.row.key, revision: source.row.revision, required, verified,
    summary: actions.length === 1 ? actions[0].summary : `${actions[0].summary} (+${actions.length - 1} more action${actions.length > 2 ? "s" : ""})`,
    evidence: actions.length === 1 ? actions[0].evidence : `${actions.filter(action => action.verified === "yes").length} match; ${actions.filter(action => action.verified === "no").length} differ; ${actions.filter(action => action.verified === "review").length} need review.`,
    actions, conversation: bounded.thread.messages.map(copyMessage), checkedAt: deps.now().toISOString() };
}
