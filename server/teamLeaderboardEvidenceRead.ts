import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type {
  TeamEvidence, TeamEvidenceFamilyCoverage, TeamEvidenceRead, TeamEvidenceVisit,
  TeamEvidenceVisitHistory, TeamEvidenceWeekInput, TeamEvidenceWindow,
} from "../shared/teamLeaderboardEvidence";
import type { SelectPort, SqlRow, SqlValue } from "./instinct/readDb";
import { safeReadDbError } from "./instinct/readDb";
import { sourceInstant } from "./instinct/sources";
import { customerEmailBinding } from "./instinct/claudeCustomerEmailSource";
import type { CustomerEmailBinding, CustomerEmailSnapshot } from "./instinct/claudeCustomerEmail";
import { staffCallSourceSchema } from "./instinct/claudeStaffCalls";
import { normalizePhone } from "./utils/phone";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";

const BATCH = 100;
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v)).digest("hex");
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const obj = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function json(value: unknown): unknown { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; } }
function rowId(value: unknown): string {
  const valueString = typeof value === "bigint" ? value.toString() : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^[1-9]\d*$/.test(valueString)) throw new Error("INVALID_SOURCE_ROW_ID");
  return valueString;
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value); return Number.isSafeInteger(result) ? result : null;
}
const email = (value: unknown): string | null => text(value)?.trim().toLowerCase() ?? null;
const sqlDate = (at: string): string => at.replace("T", " ").replace("Z", "");
const inWindow = (at: string | null, window: TeamEvidenceWindow): boolean => at !== null && at >= window.startInclusiveUtc && at < window.endExclusiveUtc && at <= window.capturedAtUtc;
const dateDay = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && sourceInstant(`${value}T00:00:00Z`)?.slice(0, 10) === value ? value : null;

/** All identifiers and SELECT projections are literal; only values are bound.
 * ID paging has no total cap. Empty successful pages are exhausted, not unavailable. */
async function pages(port: SelectPort, statement: string, params: readonly SqlValue[], consume: (row: SqlRow) => Promise<void> | void, coverage: TeamEvidenceFamilyCoverage): Promise<void> {
  let cursor = "0";
  try {
    for (;;) {
      const batch = await port.select(statement, [cursor, ...params, BATCH]);
      if (!Array.isArray(batch) || batch.length > BATCH) throw new Error("INVALID_SOURCE_PAGE");
      if (!batch.length) { coverage.exhausted = true; break; }
      for (const row of batch) {
        const next = rowId(row.id);
        if (BigInt(next) <= BigInt(cursor)) throw new Error("NONADVANCING_SOURCE_CURSOR");
        cursor = next; coverage.scannedRows++;
        await consume(row);
      }
      // Always confirm exhaustion with an empty page, including exact multiples of 100.
    }
  } catch (error) {
    coverage.status = "unavailable";
    coverage.exhausted = false;
    coverage.limitations.push(error instanceof Error && /^(NONADVANCING_SOURCE_CURSOR|INVALID_SOURCE_ROW_ID|INVALID_SOURCE_PAGE|INVALID_TEAM_ROW|INVALID_VISIT_ROW|INVALID_ASSIGNMENT_ROW)$/.test(error.message) ? error.message : safeReadDbError(error).reason);
  }
}
function make(store: string, row: SqlRow, suffix: string, raw: unknown, values: Partial<TeamEvidence> = {}): TeamEvidence {
  const sourceRowId = rowId(row.id);
  const base = {
    sourceKind: "sms" as const, store, sourceRowId, providerId: null, sessionId: null, threadId: null,
    originalText: null, occurredAtUtc: null, observedAtUtc: sourceInstant(row.createdAt),
    timeBasis: "unknown" as const, bodyBasis: "missing" as const, speakerBasis: "unverified" as const,
    customerPhone: null, customerEmail: null, customerName: null, businessLine: null, mailboxEmail: null,
    limitations: [] as string[], ...values,
  };
  return { id: `team-evidence:${hash([store, sourceRowId, suffix])}`, revision: hash([base, raw]), ...base };
}
function gap(store: string, row: SqlRow, reason: string, values: Partial<TeamEvidence> = {}): TeamEvidence {
  return make(store, row, "gap", reason, { ...values, originalText: null, bodyBasis: "missing", occurredAtUtc: null, timeBasis: "unknown", limitations: [reason, ...(values.limitations ?? [])] });
}

// Session updatedAt is schema-managed on every row update. No upper updatedAt
// bound: later conversation activity must not hide original weekly messages.
const SESSION_SQL = "SELECT `id`, `leadPhone`, `leadName`, `messageHistory`, `createdAt`, `updatedAt` FROM `conversation_sessions` WHERE `id` > ? AND `createdAt` < ? AND `updatedAt` >= ? ORDER BY `id` ASC LIMIT ?";
const SMS_SQL = "SELECT `id`, `fromPhone`, `toPhone`, `message`, `openPhoneMessageId`, `receivedAt`, `createdAt` FROM `inbound_sms` WHERE `id` > ? AND ((`receivedAt` >= ? AND `receivedAt` < ?) OR `receivedAt` IS NULL OR `receivedAt` <= ?) ORDER BY `id` ASC LIMIT ?";
const RECEIPT_SQL = "SELECT `id`, `quickAction`, `channel`, `metadata`, `activeDedupKey`, `sessionId`, `createdAt`, `lastActivityAt` FROM `ops_chat_messages` WHERE `id` > ? AND `quickAction` = ? AND `channel` = ? AND `createdAt` <= ? ORDER BY `id` ASC LIMIT ?";
const QUO_SQL = "SELECT `id`, `sessionId`, `openphoneCallId`, `callerPhone`, `direction`, `transcript`, `callStartedAt`, `createdAt` FROM `openphone_call_recordings` WHERE `id` > ? AND ((`callStartedAt` >= ? AND `callStartedAt` < ?) OR `callStartedAt` IS NULL) ORDER BY `id` ASC LIMIT ?";
const QUO_EXACT_SQL = "SELECT `id`, `sessionId`, `openphoneCallId`, `callerPhone`, `direction`, `transcript`, `callStartedAt`, `createdAt` FROM `openphone_call_recordings` WHERE `id` = ?";
const VOICE_SQL = "SELECT `id`, `vapiCallId`, `sessionId`, `callerPhone`, `transcript`, `createdAt` FROM `voice_calls` WHERE `id` > ? AND `createdAt` <= ? ORDER BY `id` ASC LIMIT ?";
const CALL_LOG_SQL = "SELECT `id`, `vapiCallId`, `calledPhone`, `calledTarget`, `transcript`, `transcriptEnglish`, `firedAt`, `completedAt`, `createdAt`, `updatedAt` FROM `call_log` WHERE `id` > ? AND ((`firedAt` >= ? AND `firedAt` < ?) OR ((`firedAt` IS NULL OR `firedAt` <= ?) AND `createdAt` <= ?)) ORDER BY `id` ASC LIMIT ?";
const FIELD_SQL = "SELECT `id`, `vapiCallId`, `clientStatusInquirySessionId`, `step`, `calledPhone`, `transcript`, `completedAt`, `createdAt` FROM `field_mgmt_calls` WHERE `id` > ? AND ((`completedAt` >= ? AND `completedAt` < ?) OR `createdAt` <= ?) ORDER BY `id` ASC LIMIT ?";
const CONFIRM_SQL = "SELECT `id`, `vapiCallId`, `leadflowJobId`, `calledPhone`, `transcript`, `firedAt`, `completedAt`, `createdAt`, `updatedAt` FROM `confirmation_calls` WHERE `id` > ? AND ((`firedAt` >= ? AND `firedAt` < ?) OR ((`firedAt` IS NULL OR `firedAt` <= ?) AND `createdAt` <= ?)) ORDER BY `id` ASC LIMIT ?";
// A current thread can have advanced after the requested week; it still exposes a coverage gap.
const META_SQL = "SELECT `id`, `threadId`, `senderName`, `senderEmail`, `snippet`, `lastMessageAt`, `messageCount`, `createdAt`, `updatedAt` FROM `gmail_thread_meta` WHERE `id` > ? AND `createdAt` <= ? ORDER BY `id` ASC LIMIT ?";
const DRAFT_SQL = "SELECT `id`, `threadId`, `inboundMessageId`, `sessionId`, `fromEmail`, `replyToEmail`, `senderName`, `originalMessage`, `createdAt`, `updatedAt` FROM `madison_email_drafts` WHERE `id` > ? AND (`createdAt` >= ? AND `createdAt` < ?) ORDER BY `id` ASC LIMIT ?";

function sessionEvidence(row: SqlRow, window: TeamEvidenceWindow): TeamEvidence[] {
  const history = json(row.messageHistory), contact = { customerPhone: normalizePhone(text(row.leadPhone)), customerName: text(row.leadName), sessionId: rowId(row.id) };
  if (!Array.isArray(history)) return [gap("conversation_sessions", row, "Stored message history is malformed; weekly message coverage is unknown", contact)];
  const result: TeamEvidence[] = []; let unknown = 0;
  history.forEach((raw, index) => {
    const entry = obj(raw), metadata = obj(entry?.metadata);
    const at = sourceInstant(entry?.ts) ?? sourceInstant(entry?.timestamp);
    if (!at) { unknown++; return; }
    if (!inWindow(at, window)) return;
    const envelopes = [entry, metadata].filter((value): value is Record<string, unknown> => value !== null);
    const ids = Array.from(new Set(envelopes.flatMap(value => [value.opMsgId, value.openPhoneId, value.openPhoneMessageId, value.providerMessageId]).map(text).filter((value): value is string => value !== null)));
    const speakerBasis = entry?.role === "user" || entry?.role === "customer" ? "customer" : ["assistant", "staff", "system"].includes(String(entry?.role)) ? "non_customer" : "unverified";
    const limitations: string[] = [];
    const phones = (keys: string[]) => Array.from(new Set(envelopes.flatMap(value => keys.map(key => value[key])).filter(value => value != null).map(value => normalizePhone(text(value)))));
    const from = phones(["from", "fromPhone"]), to = phones(["to", "toPhone"]), explicit = phones(["customerPhone"]);
    const lines = phones(["businessLine", "businessPhone"]);
    const business = Array.from(new Set([...lines, ...(speakerBasis === "customer" ? to : speakerBasis === "non_customer" ? from : [])]));
    const contradictory = explicit.some(value => value !== contact.customerPhone) || (speakerBasis === "customer" ? from : speakerBasis === "non_customer" ? to : []).some(value => value !== contact.customerPhone)
      || [from, to, business].some(values => values.length > 1 || values.includes(null))
      || envelopes.some(value => value.sessionId != null && String(value.sessionId) !== contact.sessionId)
      || business.includes(contact.customerPhone) && contact.customerPhone !== null
      || envelopes.some(value => value.direction != null && !(speakerBasis === "customer" ? ["incoming", "inbound"] : speakerBasis === "non_customer" ? ["outgoing", "outbound"] : ["unknown"]).includes(String(value.direction)))
      || entry?.metadata != null && !metadata
      || envelopes.some(value => value.cc != null && (!Array.isArray(value.cc) || value.cc.length > 0));
    if (contradictory) limitations.push("Explicit message endpoints/session/direction conflict; customer speaker is unverified");
    if (ids.length > 1) limitations.push("Conflicting provider IDs within one original message; all source versions retained");
    if (!business.length) limitations.push("Historical business recipient line is not stored");
    if (!text(entry?.content)) limitations.push("Original message body is missing");
    if (!contact.customerPhone) limitations.push("Customer phone is invalid or missing");
    result.push(make("conversation_sessions", row, `message:${index}`, raw, { ...contact, providerId: ids.length === 1 ? ids[0] : null,
      originalText: text(entry?.content), occurredAtUtc: at, timeBasis: "original", bodyBasis: text(entry?.content) ? "original" : "missing",
      speakerBasis: contradictory ? "unverified" : speakerBasis, businessLine: business.length === 1 ? business[0] : null,
      observedAtUtc: sourceInstant(row.updatedAt) ?? sourceInstant(row.createdAt), limitations }));
  });
  if (unknown) result.push(gap("conversation_sessions", row, `${unknown} stored messages have missing/invalid original timestamps; weekly membership is unknown and undated bodies are withheld`, contact));
  return result;
}

function emailReceiptEvidence(row: SqlRow, window: TeamEvidenceWindow): TeamEvidence[] {
  const state = obj(json(row.metadata));
  if (state?.type === "thread") return []; // Authority is not a message receipt.
  const binding = obj(state?.binding); let actual: CustomerEmailBinding | null = null;
  try { if (binding) actual = customerEmailBinding(binding.snapshot as CustomerEmailSnapshot, String(binding.inboundMessageId), Number(binding.receivedAt)); } catch { /* closed gap below */ }
  const receiptKey = actual ? `ce-receipt:v1:${hash([actual.mailboxEmail, actual.threadId, actual.inboundMessageId])}` : null;
  if (state?.version !== 1 || state.type !== "receipt" || row.sessionId !== null || !actual || !isDeepStrictEqual(actual, binding) || row.activeDedupKey !== receiptKey) {
    return [gap("ops_chat_messages:email_receipts", row, "Original email receipt binding is invalid; original body/date/customer cannot be verified", { sourceKind: "email" })];
  }
  const result: TeamEvidence[] = [];
  for (const message of actual.snapshot.messages) {
    const at = sourceInstant(message.createdAt);
    if (!at) { result.push(gap("ops_chat_messages:email_receipts", row, "Original snapshot message timestamp is invalid", { sourceKind: "email", threadId: actual.threadId })); continue; }
    if (!inWindow(at, window)) continue;
    const prefix: CustomerEmailSnapshot = { ...actual.snapshot, messages: actual.snapshot.messages.filter(turn => turn.createdAt <= message.createdAt) };
    let historical: CustomerEmailBinding | null = null;
    try { historical = customerEmailBinding(prefix, message.id, actual.receivedAt); } catch { /* unverified original retained */ }
    const nonCustomer = message.fromEmail === actual.mailboxEmail && message.labelIds.includes("SENT") && !message.labelIds.includes("DRAFT");
    const body = text(message.text) ?? text(message.html);
    const originalBodies = [{ basis: "primary", body }, ...(text(message.text) && text(message.html) && message.text !== message.html ? [{ basis: "html", body: message.html }] : [])];
    for (const variant of originalBodies) result.push(make("ops_chat_messages:email_receipts", row, `message:${message.id}:${variant.basis}`, { ...message, labelIds: undefined }, {
      sourceKind: "email", providerId: message.id, threadId: actual.threadId, originalText: variant.body,
      occurredAtUtc: at, observedAtUtc: sourceInstant(actual.receivedAt), timeBasis: "original", bodyBasis: body ? "original" : "missing",
      speakerBasis: historical ? "customer" : nonCustomer ? "non_customer" : "unverified",
      customerEmail: historical?.fromEmail ?? actual.fromEmail, customerName: historical?.senderName ?? actual.senderName,
      mailboxEmail: actual.mailboxEmail, limitations: [
        ...(!historical && !nonCustomer ? ["Historical original email routing/speaker cannot pass the passive binding validator"] : []),
        ...(variant.basis === "html" || !text(message.text) && text(message.html) ? ["Original body is HTML; no stripped/rewritten text substituted"] : []),
        ...(!body ? ["Original snapshot body is missing"] : []),
        ...(historical?.replyToEmail && historical.replyToEmail !== historical.fromEmail ? ["Original Reply-To differs from From; sender contact retained without assuming equivalence"] : []),
      ],
    }));
  }
  return result;
}

// The existing exported source schema is passive. Importing it invokes no model,
// source reader, task handler, send or database operation.
const staffReceiptSchema = z.object({
  version: z.literal(1), providerCallId: z.string().min(1), recordingId: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(["generating", "prepared", "no_task", "failed"]),
  taskId: z.number().int().positive().nullable(), code: z.string().nullable(), sourceSnapshot: staffCallSourceSchema.optional(),
}).strict().refine(state => state.phase === "prepared" ? state.taskId !== null && state.code === null : state.taskId === null && (state.phase === "failed" ? state.code !== null : state.code === null));
async function staffReceiptEvidence(port: SelectPort, row: SqlRow, window: TeamEvidenceWindow): Promise<TeamEvidence[]> {
  const parsed = staffReceiptSchema.safeParse(json(row.metadata));
  if (!parsed.success || !parsed.data.sourceSnapshot || row.sessionId !== null) return [gap("ops_chat_messages:staff_call_receipts", row, "Saved staff call receipt sourceSnapshot is missing or invalid", { sourceKind: "phone_unverified" })];
  const state = parsed.data, source = state.sourceSnapshot!;
  if (state.providerCallId !== source.providerCallId || state.recordingId !== source.recordingId || state.fingerprint !== hash(source)
    || row.activeDedupKey !== `sc-receipt:v1:${createHash("sha256").update(source.providerCallId).digest("hex")}`) return [gap("ops_chat_messages:staff_call_receipts", row, "Staff receipt immutable source identity/fingerprint conflicts", { sourceKind: "phone_unverified" })];
  const at = sourceInstant(source.receivedAt);
  if (at && !inWindow(at, window)) return [];
  const recordings = await port.select(QUO_EXACT_SQL, [source.recordingId]);
  const saved = recordings.length === 1 ? recordings[0] : null;
  if (!saved || saved.openphoneCallId !== source.providerCallId || text(saved.callerPhone) !== source.callerPhone || saved.direction !== source.direction) return [gap("ops_chat_messages:staff_call_receipts", row, "Staff call snapshot conflicts with exact saved recording identity", { sourceKind: "phone_unverified" })];
  const limitations = ["Verified receipt handling provenance is not proof of customer/staff speaker identity; full call remains unverified speaker evidence"];
  if (sourceInstant(saved.callStartedAt) !== at) limitations.push("Saved call occurrence conflicts with immutable provider-start snapshot; variants retained");
  if (!at) limitations.push("Original call-start timestamp is invalid; no original date fabricated");
  return [make("ops_chat_messages:staff_call_receipts", row, "call", source, {
    sourceKind: source.staffUserId ? "human_call" : "phone_unverified", providerId: source.providerCallId, sessionId: source.sessionId === null ? null : String(source.sessionId),
    originalText: source.evidenceSegments.join("\n"), occurredAtUtc: at, timeBasis: at ? "original" : "unknown", bodyBasis: "snapshot", speakerBasis: "unverified",
    customerPhone: normalizePhone(source.callerPhone), customerName: source.callerName, businessLine: normalizePhone(source.businessPhoneNumber),
    limitations: [...limitations, `Saved ${source.transcriptSource} transcript provenance; staffUserId=${source.staffUserId ?? "unknown"}`],
  })];
}
function quoEvidence(row: SqlRow, window: TeamEvidenceWindow): TeamEvidence[] {
  const at = sourceInstant(row.callStartedAt); if (at && !inWindow(at, window)) return [];
  const dialogue = json(row.transcript); const valid = Array.isArray(dialogue) && dialogue.length > 0 && dialogue.every(turn => obj(turn) && text(obj(turn)?.content));
  return [make("openphone_call_recordings", row, "call", dialogue ?? row.transcript, {
    sourceKind: "phone_unverified", providerId: text(row.openphoneCallId), sessionId: row.sessionId == null ? null : String(row.sessionId),
    originalText: valid ? (dialogue as Record<string, unknown>[]).map(turn => turn.content).join("\n") : null,
    occurredAtUtc: at, timeBasis: at ? "original" : "unknown", bodyBasis: valid ? "original" : "missing",
    customerPhone: normalizePhone(text(row.callerPhone)), speakerBasis: "unverified",
    limitations: ["Quo storage/provider identity alone does not verify human handling or customer speakers", "Session phone linkage requires independent corroboration", `Stored call direction=${text(row.direction) ?? "unknown"}`,
      ...(!valid ? ["Original transcript missing or malformed; no summary used"] : []), ...(!at ? ["Original call occurrence is missing; weekly membership unknown"] : [])],
  })];
}
function aiEvidence(store: string, row: SqlRow, window: TeamEvidenceWindow): TeamEvidence[] {
  const originalAt = store === "call_log" || store === "confirmation_calls" ? sourceInstant(row.firedAt) : null;
  const observed = store === "field_mgmt_calls" ? sourceInstant(row.completedAt) ?? sourceInstant(row.createdAt) : sourceInstant(row.createdAt);
  if (originalAt && !inWindow(originalAt, window)) return [];
  if (!originalAt && observed && !inWindow(observed, window)) return [gap(store, row, "Original call occurrence is not stored; old undated call membership cannot be established", { sourceKind: "ai_call" })];
  const nonCustomer = store === "call_log" && row.calledTarget !== "client";
  const limitations = ["Stored AI transcript does not independently verify customer speaker identity", "Business call line and transcript-finalization provenance are not stored", `Stored family direction=${store === "voice_calls" ? "inbound-family (caller attribution unverified)" : "outbound-family"}`];
  if (!originalAt) limitations.push("Record creation/completion is observation only, not original call occurrence; no match-eligible date fabricated");
  if (store === "field_mgmt_calls" || store === "confirmation_calls") limitations.push("Workflow linkage is not independently verified by this evidence reader");
  if (store === "voice_calls") limitations.push("Caller phone/session may be forwarding or model-derived and needs corroboration");
  if (!text(row.transcript)) limitations.push("Original transcript is missing; summaries/translations are not original evidence");
  const base: Partial<TeamEvidence> = { sourceKind: "ai_call", providerId: text(row.vapiCallId), originalText: text(row.transcript), occurredAtUtc: originalAt,
    observedAtUtc: observed, timeBasis: originalAt ? "original" : observed ? "stored" : "unknown", bodyBasis: text(row.transcript) ? "original" : "missing",
    speakerBasis: nonCustomer ? "non_customer" : "unverified", customerPhone: nonCustomer ? null : normalizePhone(text(store === "voice_calls" ? row.callerPhone : row.calledPhone)),
    sessionId: store === "voice_calls" && row.sessionId != null ? String(row.sessionId) : null, limitations };
  const result = [make(store, row, "call", { transcript: row.transcript, firedAt: row.firedAt, completedAt: row.completedAt, calledTarget: row.calledTarget }, base)];
  if (store === "call_log" && text(row.transcriptEnglish) && row.transcriptEnglish !== row.transcript) result.push(make(store, row, "translation", row.transcriptEnglish, {
    ...base, originalText: text(row.transcriptEnglish), bodyBasis: "snapshot", speakerBasis: "unverified",
    limitations: [...limitations, "Stored English translation is a non-original variant, not eligible original complaint evidence"],
  }));
  return result;
}

/** Collapse only exact provider/contact/body/time/basis identities. Retain all conflicts.
 * Lack of original date never licenses cross-store provider deduplication. */
function deduplicate(items: TeamEvidence[]): TeamEvidence[] {
  const groups = new Map<string, TeamEvidence[]>(), plain: TeamEvidence[] = [];
  for (const item of items) {
    if (!item.providerId || !item.originalText || !item.customerPhone && !item.customerEmail) { plain.push(item); continue; }
    const namespace = item.sourceKind === "sms" ? "openphone-sms" : item.sourceKind === "email" ? `gmail:${item.mailboxEmail ?? "unknown"}` : item.store.includes("staff_call") || item.store === "openphone_call_recordings" ? "openphone-call" : "vapi-call";
    const key = hash([namespace, item.providerId]); const list = groups.get(key) ?? []; list.push(item); groups.set(key, list);
  }
  for (const list of Array.from(groups.values())) {
    const originals = new Map<string, TeamEvidence>();
    for (const item of list.sort((a, b) => a.id.localeCompare(b.id))) {
      const at = item.occurredAtUtc ?? (item.timeBasis === "received" ? item.observedAtUtc : null);
      const key = at ? hash([item.customerPhone, item.customerEmail, item.originalText, at, item.timeBasis, item.bodyBasis, item.speakerBasis]) : item.id;
      const prior = originals.get(key);
      if (prior) prior.limitations.push(`Exact provider duplicate retained as provenance: ${item.store}:${item.sourceRowId} (${item.id}, revision ${item.revision})`);
      else originals.set(key, item);
    }
    if (originals.size > 1) for (const item of Array.from(originals.values())) item.limitations.push("Conflicting provider identity/contact/body/time/provenance versions; all originals/variants retained without precedence erasure");
    plain.push(...Array.from(originals.values()));
  }
  return plain.sort((a, b) => (a.occurredAtUtc ?? a.observedAtUtc ?? "").localeCompare(b.occurredAtUtc ?? b.observedAtUtc ?? "") || a.id.localeCompare(b.id));
}

export async function readTeamEvidenceWeek(port: SelectPort, input: TeamEvidenceWeekInput, now = new Date()): Promise<TeamEvidenceRead> {
  const window = resolveTeamEvidenceWindow(input, now);
  const start = sqlDate(window.startInclusiveUtc), end = sqlDate(window.endExclusiveUtc), captured = sqlDate(window.capturedAtUtc);
  const startMs = Date.parse(window.startInclusiveUtc), endMs = Date.parse(window.endExclusiveUtc);
  const evidence: TeamEvidence[] = [], families: TeamEvidenceFamilyCoverage[] = [];
  async function family(store: string, statement: string, params: readonly SqlValue[], adapter: (row: SqlRow) => Promise<TeamEvidence[]> | TeamEvidence[]) {
    const coverage: TeamEvidenceFamilyCoverage = { store, scannedRows: 0, evidenceItems: 0, exhausted: false, status: "read", limitations: [] };
    families.push(coverage);
    await pages(port, statement, params, async row => { const items = await adapter(row); coverage.evidenceItems += items.length; evidence.push(...items); }, coverage);
    if (coverage.status === "unavailable") {
      const unavailable = make(store, { id: "1" }, "unavailable", coverage.limitations, { sourceKind: store.includes("email") ? "email" : store.includes("call") ? "phone_unverified" : "sms", limitations: [`Source family unavailable/incomplete: ${store}`, ...coverage.limitations] });
      // This is a family gap, not a claimed database row or original event.
      unavailable.sourceRowId = "";
      unavailable.id = `team-evidence:${hash([store, "family-unavailable"])}`;
      unavailable.revision = hash([store, "family-unavailable", coverage.limitations]);
      evidence.push(unavailable);
    }
  }
  await family("conversation_sessions", SESSION_SQL, [end, start], row => sessionEvidence(row, window));
  await family("inbound_sms", SMS_SQL, [startMs, endMs, 0], row => {
    const at = sourceInstant(row.receivedAt); if (at && !inWindow(at, window)) return [];
    if (!at) return [gap("inbound_sms", row, "SMS receivedAt is invalid/missing; weekly membership is unknown", { customerPhone: normalizePhone(text(row.fromPhone)) })];
    return [make("inbound_sms", row, "message", { body: row.message, providerId: row.openPhoneMessageId, receivedAt: row.receivedAt, from: row.fromPhone, to: row.toPhone }, {
      providerId: text(row.openPhoneMessageId), originalText: text(row.message), occurredAtUtc: null, observedAtUtc: at, timeBasis: "received", bodyBasis: text(row.message) ? "original" : "missing",
      speakerBasis: "customer", customerPhone: normalizePhone(text(row.fromPhone)), businessLine: normalizePhone(text(row.toPhone)),
      limitations: ["receivedAt is stored receipt time, not original provider message occurrence", ...(!text(row.message) ? ["Original SMS body missing"] : [])],
    })];
  });
  await family("ops_chat_messages:email_receipts", RECEIPT_SQL, ["claude_customer_email_receipt", "instinct_email_receipts", captured], row => emailReceiptEvidence(row, window));
  await family("openphone_call_recordings", QUO_SQL, [start, end], row => quoEvidence(row, window));
  await family("ops_chat_messages:staff_call_receipts", RECEIPT_SQL, ["claude_staff_call_receipt", "instinct_staff_call", captured], row => staffReceiptEvidence(port, row, window));
  await family("voice_calls", VOICE_SQL, [captured], row => aiEvidence("voice_calls", row, window));
  await family("call_log", CALL_LOG_SQL, [startMs, endMs, 0, captured], row => aiEvidence("call_log", row, window));
  await family("field_mgmt_calls", FIELD_SQL, [start, end, captured], row => aiEvidence("field_mgmt_calls", row, window));
  await family("confirmation_calls", CONFIRM_SQL, [startMs, endMs, 0, captured], row => aiEvidence("confirmation_calls", row, window));
  // Old/current snippets still expose unresolved weekly coverage. Index the
  // retained originals once rather than filtering all evidence for every row.
  const emailIdsByThread = new Map<string | null, Set<string | null>>();
  const emailContactsByProvider = new Map<string | null, Set<string | null>>();
  for (const item of evidence) {
    if (item.sourceKind !== "email" || item.bodyBasis !== "original") continue;
    const ids = emailIdsByThread.get(item.threadId) ?? new Set<string | null>();
    ids.add(item.providerId); emailIdsByThread.set(item.threadId, ids);
    const contacts = emailContactsByProvider.get(item.providerId) ?? new Set<string | null>();
    contacts.add(item.customerEmail); emailContactsByProvider.set(item.providerId, contacts);
  }
  await family("gmail_thread_meta", META_SQL, [captured], row => {
    const ids = emailIdsByThread.get(row.threadId as string | null);
    const at = sourceInstant(row.lastMessageAt), count = number(row.messageCount);
    if (count !== null && ids?.size && count <= ids.size) return [];
    return [make("gmail_thread_meta", row, "partial", { snippet: row.snippet, lastMessageAt: row.lastMessageAt, messageCount: row.messageCount }, {
      sourceKind: "email", threadId: text(row.threadId), originalText: text(row.snippet), customerEmail: email(row.senderEmail), customerName: text(row.senderName),
      occurredAtUtc: null, observedAtUtc: at ?? sourceInstant(row.updatedAt) ?? sourceInstant(row.createdAt), timeBasis: "stored", bodyBasis: text(row.snippet) ? "snippet" : "missing",
      limitations: ["Thread snippet is not an original message or complete original body; original mailbox/headers/date are unavailable", "Thread may span target week even if latest message is outside it; weekly original coverage unresolved"],
    })];
  });
  await family("madison_email_drafts", DRAFT_SQL, [start, end], row => {
    if (emailContactsByProvider.get(row.inboundMessageId as string | null)?.has(email(row.fromEmail))) return [];
    return [make("madison_email_drafts", row, "partial", row.originalMessage, { sourceKind: "email", providerId: text(row.inboundMessageId), threadId: text(row.threadId),
      originalText: text(row.originalMessage), customerEmail: email(row.fromEmail), customerName: text(row.senderName), sessionId: row.sessionId == null ? null : String(row.sessionId),
      bodyBasis: text(row.originalMessage) ? "snapshot" : "missing", timeBasis: "stored", limitations: ["Draft-stored inbound snapshot is partial coverage, not a verified original email; original headers/mailbox/date are missing"],
    })];
  });
  const retained = deduplicate(evidence);
  return { window, evidence: retained, families, collectionComplete: families.every(item => item.status === "read" && item.exhausted),
    limitations: Array.from(new Set(["SELECT traversal is not a transactional source snapshot; completion means retained family queries exhausted, not provider-wide completeness", ...families.flatMap(item => item.limitations.map(reason => `${item.store}: ${reason}`)), ...retained.flatMap(item => item.limitations)])) };
}

const TEAMS_SQL = "SELECT `id`, `name`, `launch27TeamId` FROM `scheduling_teams` WHERE `id` > ? ORDER BY `id` ASC LIMIT ?";
const VISITS_SQL = "SELECT j.`id`, j.`origin`, j.`bookingId`, j.`launch27BookingId`, j.`jobDate`, j.`serviceDateTime`, j.`bookingStatus`, j.`customerName`, j.`customerPhone`, j.`customerEmail`, j.`jobAddress`, j.`teamId`, j.`teamName`, j.`updatedAt`, j.`customerRating`, p.`jobStatus` AS `progressStatus`, p.`teamId` AS `progressTeamId`, p.`updatedAt` AS `progressUpdatedAt`, p.`etaTimestamp`, s.`teamId` AS `signoffTeamId`, s.`signedOffAt`, b.`publicBookingNumber`, b.`status` AS `canonicalBookingStatus`, b.`requestedLocalDate` AS `canonicalRequestedLocalDate`, b.`customerPhone` AS `bookingCustomerPhone`, b.`customerEmail` AS `bookingCustomerEmail` FROM `leadflow_jobs` j LEFT JOIN `cleaner_portal_job_progress` p ON p.`leadflowJobId` = j.`id` LEFT JOIN `cleaner_portal_job_signoffs` s ON s.`leadflowJobId` = j.`id` LEFT JOIN `bookings` b ON b.`id` = j.`bookingId` WHERE j.`id` > ? AND j.`jobDate` <= ?";
const VISIT_PHONE_SQL = "(REGEXP_REPLACE(COALESCE(j.`customerPhone`, ?), ?, ?) LIKE ? OR REGEXP_REPLACE(COALESCE(b.`customerPhone`, ?), ?, ?) LIKE ?)";
const ASSIGNMENTS_SQL = "SELECT `id`, `bookingId`, `teamId`, `teamName`, `status`, `assignedAt`, `unassignedAt` FROM `booking_assignments` WHERE `id` > ? AND `bookingId` IN";

/** Retained all-date history for exact evidence contacts, never name grouping.
 * Returned team IDs use scheduling-team identity; imported and portal IDs are
 * mapped solely by unique launch27TeamId, never by coincident numeric ID/name. */
export async function readTeamEvidenceVisitHistory(port: SelectPort, evidence: readonly TeamEvidence[], window: TeamEvidenceWindow): Promise<TeamEvidenceVisitHistory> {
  const result: TeamEvidenceVisitHistory = { visits: [], teams: [], assignments: [], complete: true, limitations: [] };
  const contacts = new Map<string, { phone: string | null; email: string | null }>();
  for (const item of evidence) {
    // Coverage gaps stay in the evidence read, but cannot support a dated
    // customer lookup. Keep receipt-time SMS and speaker-unverified calls.
    const at = sourceInstant(item.occurredAtUtc) ?? (item.timeBasis === "received" ? sourceInstant(item.observedAtUtc) : null);
    if (!text(item.originalText) || item.bodyBasis === "snippet" || item.bodyBasis === "missing" || item.speakerBasis === "non_customer"
      || item.bodyBasis === "snapshot" && item.limitations.some(reason => /translation|non-original variant/i.test(reason))
      || !["original", "received"].includes(item.timeBasis) || !inWindow(at, window)) continue;
    const contact = { phone: normalizePhone(item.customerPhone), email: email(item.customerEmail) };
    if (contact.phone && contact.phone === normalizePhone(item.businessLine) || contact.email && contact.email === email(item.mailboxEmail)) continue;
    if (contact.phone || contact.email) contacts.set(hash(contact), contact);
  }
  if (!contacts.size) return result;
  async function scan(store: string, statement: string, params: readonly SqlValue[], consume: (row: SqlRow) => void) {
    const coverage: TeamEvidenceFamilyCoverage = { store, scannedRows: 0, evidenceItems: 0, exhausted: false, status: "read", limitations: [] };
    await pages(port, statement, params, consume, coverage);
    if (coverage.status !== "read" || !coverage.exhausted) { result.complete = false; result.limitations.push(...coverage.limitations.map(value => `${store}: ${value}`)); }
  }
  await scan("scheduling_teams", TEAMS_SQL, [], row => {
    const id = number(row.id), launch27TeamId = number(row.launch27TeamId);
    if (id === null || id <= 0 || !text(row.name)) throw new Error("INVALID_TEAM_ROW");
    result.teams.push({ id, name: String(row.name), launch27TeamId });
  });
  const mapTeam = (raw: unknown, namespace: "native" | "launch27", description: string): number | null => {
    const id = number(raw); if (id === null) return null;
    const matches = result.teams.filter(team => namespace === "native" ? team.id === id : team.launch27TeamId === id);
    if (matches.length !== 1) { result.limitations.push(`${description}: ${namespace} team ${id} has missing/ambiguous scheduling mapping`); return null; }
    return matches[0].id;
  };
  const visits = new Map<number, TeamEvidenceVisit>();
  const cutoff = window.endExclusiveUtc < window.capturedAtUtc ? window.endExclusiveUtc : window.capturedAtUtc;
  const contactList = Array.from(contacts.values());
  for (let offset = 0; offset < contactList.length; offset += BATCH) {
    const chunk = contactList.slice(offset, offset + BATCH);
    const phones = new Set(chunk.map(contact => contact.phone).filter((value): value is string => value !== null));
    const emails = new Set(chunk.map(contact => contact.email).filter((value): value is string => value !== null));
    // SQL is only a coarse superset. Final matching always uses the existing canonical utility.
    const predicates: string[] = [], params: SqlValue[] = [window.throughDate];
    for (const phone of Array.from(phones)) {
      const suffix = `%${phone.slice(2)}`;
      predicates.push(VISIT_PHONE_SQL); params.push("", "[^0-9]", "", suffix, "", "[^0-9]", "", suffix);
    }
    if (emails.size) {
      const placeholders = Array.from(emails, () => "?").join(", ");
      predicates.push(`(LOWER(TRIM(j.\`customerEmail\`)) IN (${placeholders}) OR LOWER(TRIM(b.\`customerEmail\`)) IN (${placeholders}))`);
      params.push(...Array.from(emails), ...Array.from(emails));
    }
    await scan("leadflow_jobs", `${VISITS_SQL} AND (${predicates.join(" OR ")}) ORDER BY j.\`id\` ASC LIMIT ?`, params, row => {
      const jobPhone = normalizePhone(text(row.customerPhone)), bookingPhone = normalizePhone(text(row.bookingCustomerPhone));
      const jobEmail = email(row.customerEmail), bookingEmail = email(row.bookingCustomerEmail);
      if (!(jobPhone && phones.has(jobPhone) || bookingPhone && phones.has(bookingPhone) || jobEmail && emails.has(jobEmail) || bookingEmail && emails.has(bookingEmail))) return;
      const id = number(row.id), jobDate = dateDay(row.jobDate);
      if (id === null || id <= 0 || !jobDate) throw new Error("INVALID_VISIT_ROW");
      if (jobDate > window.throughDate) return;
      const serviceStartUtc = sourceInstant(row.serviceDateTime);
      if (serviceStartUtc && serviceStartUtc >= cutoff) return;
      const bookingId = number(row.bookingId), launch27BookingId = number(row.launch27BookingId);
      if (jobPhone && bookingPhone && jobPhone !== bookingPhone || jobEmail && bookingEmail && jobEmail !== bookingEmail) result.limitations.push(`Visit ${id}: operational/canonical contact conflict; explicit review required`);
      const imported = launch27BookingId !== null || row.origin === "launch27_import" || bookingId === null && row.origin === "leadflow_recurrence";
      const storedTeamId = mapTeam(row.teamId, imported ? "launch27" : "native", `Visit ${id} stored assignment`);
      const jobStatus = text(row.bookingStatus), canonicalStatus = text(row.canonicalBookingStatus);
      const tombstones = ["cancelled", "canceled", "rescheduled", "missing_from_launch27"];
      const canonicalVisit = !imported && dateDay(row.canonicalRequestedLocalDate) === jobDate;
      const bookingStatus = canonicalVisit && canonicalStatus && !tombstones.includes(jobStatus?.toLowerCase() ?? "") ? canonicalStatus : jobStatus ?? "unknown";
      if (canonicalVisit && canonicalStatus) result.limitations.push(`Visit ${id}: native bookingStatus uses stored bookings.status (${canonicalStatus}) for matching original service date; operational state is ${jobStatus ?? "unknown"}`);
      if (canonicalVisit && canonicalStatus && tombstones.includes(canonicalStatus.toLowerCase()) && canonicalStatus.toLowerCase() !== jobStatus?.toLowerCase()) result.limitations.push(`Visit ${id}: canonical/operational cancellation state conflict`);
      const visit: TeamEvidenceVisit = {
        id, bookingId, launch27BookingId, publicBookingNumber: text(row.publicBookingNumber), jobDate, serviceStartUtc,
        bookingStatus, progressStatus: text(row.progressStatus),
        customerName: text(row.customerName) ?? "", customerPhone: jobPhone ?? bookingPhone, customerEmail: jobEmail ?? bookingEmail, address: text(row.jobAddress),
        storedTeamId, storedTeamName: text(row.teamName), progressTeamId: mapTeam(row.progressTeamId, "launch27", `Visit ${id} portal progress`),
        signoffTeamId: mapTeam(row.signoffTeamId, "launch27", `Visit ${id} portal signoff`),
        progressUpdatedAtUtc: sourceInstant(row.progressUpdatedAt), signoffAtUtc: sourceInstant(row.signedOffAt), jobUpdatedAtUtc: sourceInstant(row.updatedAt),
        customerRating: number(row.customerRating), etaTimestamp: number(row.etaTimestamp),
      };
      const prior = visits.get(id);
      if (prior && !isDeepStrictEqual(prior, visit)) { result.complete = false; result.limitations.push(`Visit ${id} changed across SELECT pages/contact traversals`); }
      else visits.set(id, visit);
      if (!serviceStartUtc) result.limitations.push(`Visit ${id}: date-only/invalid service start retained as null; same-day/future-before-report ordering requires matcher review`);
    });
  }
  result.visits = Array.from(visits.values()).sort((a, b) => a.jobDate.localeCompare(b.jobDate) || a.id - b.id);
  const bookingIds = Array.from(new Set(result.visits.map(visit => visit.bookingId).filter((id): id is number => id !== null))).sort((a, b) => a - b);
  for (let offset = 0; offset < bookingIds.length; offset += BATCH) {
    const chunk = bookingIds.slice(offset, offset + BATCH), membership = new Set(chunk);
    const placeholders = chunk.map(() => "?").join(", ");
    await scan("booking_assignments", `${ASSIGNMENTS_SQL} (${placeholders}) AND \`assignedAt\` <= ? ORDER BY \`id\` ASC LIMIT ?`, [...chunk, sqlDate(cutoff)], row => {
      const id = number(row.id), bookingId = number(row.bookingId); if (id === null || bookingId === null || !membership.has(bookingId)) throw new Error("INVALID_ASSIGNMENT_ROW");
      result.assignments.push({ id, bookingId, teamId: number(row.teamId), teamName: text(row.teamName), status: text(row.status) ?? "unknown",
        assignedAtUtc: sourceInstant(row.assignedAt), unassignedAtUtc: sourceInstant(row.unassignedAt) });
    });
  }
  result.assignments.sort((a, b) => a.bookingId - b.bookingId || a.id - b.id);
  result.limitations = Array.from(new Set(["Retained states only: progress update, ETA, signoff and job update are not manufactured completion timestamps", "Historical assignments use scheduling IDs; portal/import IDs are uniquely mapped from Launch27 IDs", "Current SELECT history is not a transactional snapshot or proof of historical fault", ...result.limitations]));
  return result;
}
