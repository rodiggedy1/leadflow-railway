import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customerTaskSchema, CLAUDE_CUSTOMER_TASK_ACTION } from "../shared/claudeCustomerTasks";
import { leadCallNotesInputSchema, type LeadCallNotesInput, type LeadCallNotesResult, type LeadCallNote } from "../shared/leadCallNotes";
import { normalizePhone } from "./utils/phone";

type DbPort = { execute(query: SQL): Promise<unknown> };
type Row = Record<string, unknown>;
type Entry = { note: LeadCallNote; voiceId?: number; recordingId?: number };
const envelopeSchema = z.object({ taskId: z.number().int().positive(), task: customerTaskSchema }).strict();
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = (value: unknown): number | null => {
  if (value == null) return null;
  return number(value instanceof Date ? value.getTime() : typeof value === "string" ? new Date(value).getTime() : value);
};
function decode(value: unknown): unknown {
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
}
function object(value: unknown): Row {
  const decoded = decode(value);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded as Row : {};
}
function details(value: unknown): LeadCallNote["details"] {
  const data = object(value);
  const labels: Record<string, string> = {
    intent: "Intent", bedrooms: "Bedrooms", bathrooms: "Bathrooms", serviceType: "Service type",
    address: "Address", quotedPrice: "Quoted price", preferredDate: "Preferred date",
    outcome: "Outcome", selectedExtras: "Selected extras",
  };
  const scalar = (v: unknown) => typeof v === "string" ? text(v) : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  return Object.entries(labels).flatMap(([key, label]) => {
    const value = Array.isArray(data[key]) ? (data[key] as unknown[]).map(scalar).filter(Boolean).join(", ") : scalar(data[key]);
    return value ? [{ label, value }] : [];
  });
}
async function rows(db: DbPort, query: SQL): Promise<Row[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Call notes query returned an invalid result.");
  return result[0] as Row[];
}

/** Passive, read-only seam. Never obtains a DB until read() has a usable identity. */
export function createLeadCallNotesReader(getDb: () => Promise<DbPort | null>) {
  return { async read(rawInput: LeadCallNotesInput): Promise<LeadCallNotesResult> {
    const input = leadCallNotesInputSchema.parse(rawInput);
    let phone = normalizePhone(input.phone);
    if (input.sessionId === null && !phone) return { phone: null, calls: [] };
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable. Call notes could not be loaded." });
    if (input.sessionId !== null) {
      const [session] = await rows(db, sql`SELECT id, leadPhone FROM conversation_sessions WHERE id = ${input.sessionId} LIMIT 1`);
      phone = normalizePhone(text(session?.leadPhone));
      if (input.phone !== null && normalizePhone(input.phone) !== phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The customer phone does not match this lead." });
      }
    }
    if (!phone) return { phone: null, calls: [] };
    // Explicit complete historical forms, never suffix/name/session-only matching.
    const forms = sql.join([phone, phone.slice(1), phone.slice(2)].map(value => sql`${value}`), sql`, `);
    const voice = await rows(db, sql`SELECT id, vapiCallId, sessionId, callerPhone, durationSeconds,
      transcript, summary, outcome, structuredData, endedReason, createdAt FROM voice_calls
      WHERE callerPhone IN (${forms}) ORDER BY createdAt DESC, id DESC LIMIT 100`);
    const staff = await rows(db, sql`SELECT id, sessionId, openphoneCallId, callerPhone, direction,
      durationSeconds, status, callStartedAt, transcript, scoreData FROM openphone_call_recordings
      WHERE callerPhone IN (${forms}) ORDER BY callStartedAt DESC, id DESC LIMIT 100`);
    const outbound = await rows(db, sql`SELECT id, calledPhone, calledTarget, vapiCallId, transcript, status,
      firedAt, completedAt, durationSeconds, notes, createdAt FROM call_log
      WHERE calledTarget = 'client' AND calledPhone IN (${forms})
      ORDER BY COALESCE(firedAt, UNIX_TIMESTAMP(createdAt) * 1000) DESC, id DESC LIMIT 100`);
    // CASE protects JSON extraction even if a historical metadata row is malformed.
    const safeMetadata = sql`CASE WHEN JSON_VALID(metadata) THEN metadata ELSE '{}' END`;
    const tasks = await rows(db, sql`SELECT id, channel, quickAction, sessionId, metadata FROM ops_chat_messages
      WHERE channel = 'command' AND quickAction = ${CLAUDE_CUSTOMER_TASK_ACTION}
      AND JSON_UNQUOTE(JSON_EXTRACT(${safeMetadata}, '$.task.customerPhone')) IN (${forms})
      AND JSON_UNQUOTE(JSON_EXTRACT(${safeMetadata}, '$.task.call.provider')) IN ('vapi', 'openphone')
      ORDER BY id DESC LIMIT 100`);
    const entries: Entry[] = [];
    for (const row of voice) {
      const startedAt = timestamp(row.createdAt);
      if (normalizePhone(text(row.callerPhone)) !== phone || startedAt === null) continue;
      const providerCallId = text(row.vapiCallId);
      const note: LeadCallNote = {
        id: `vapi:voice:${row.id}`, provider: "vapi", providerCallId, source: "madison", direction: "incoming",
        startedAt, durationSeconds: number(row.durationSeconds), outcome: text(row.outcome),
        summary: text(row.summary), transcript: text(row.transcript), details: details(row.structuredData), followUps: [],
      };
      const endedReason = text(row.endedReason);
      if (endedReason) note.details.push({ label: "Ended reason", value: endedReason });
      entries.push({ note, voiceId: Number(row.id) });
    }
    for (const row of staff) {
      const startedAt = timestamp(row.callStartedAt);
      if (normalizePhone(text(row.callerPhone)) !== phone || startedAt === null) continue;
      entries.push({ recordingId: Number(row.id), note: {
        id: `openphone:recording:${row.id}`, provider: "openphone", providerCallId: text(row.openphoneCallId), source: "staff",
        direction: row.direction === "outgoing" ? "outgoing" : "incoming", startedAt,
        durationSeconds: number(row.durationSeconds), outcome: text(row.status),
        // Stored scoring summary only; coaching/debrief is not a customer need.
        summary: text(object(row.scoreData).summary), transcript: text(row.transcript), details: [], followUps: [],
      } });
    }
    for (const row of outbound) {
      const startedAt = timestamp(row.firedAt) ?? timestamp(row.createdAt);
      if (row.calledTarget !== "client" || normalizePhone(text(row.calledPhone)) !== phone || startedAt === null) continue;
      const providerCallId = text(row.vapiCallId);
      const existing = providerCallId ? entries.find(entry => entry.note.provider === "vapi" && entry.note.providerCallId === providerCallId) : undefined;
      const staffNote = text(row.notes);
      if (existing) {
        existing.note.source = "outbound_ai";
        existing.note.direction = "outgoing";
        existing.note.transcript = text(row.transcript) ?? existing.note.transcript;
        existing.note.startedAt = startedAt;
        existing.note.durationSeconds = number(row.durationSeconds) ?? existing.note.durationSeconds;
        if (staffNote) existing.note.details.push({ label: "Staff note", value: staffNote });
      } else {
        entries.push({ note: {
          id: `vapi:outbound:${row.id}`, provider: "vapi", providerCallId, source: "outbound_ai", direction: "outgoing",
          startedAt, durationSeconds: number(row.durationSeconds), outcome: text(row.status), summary: null,
          transcript: text(row.transcript), details: staffNote ? [{ label: "Staff note", value: staffNote }] : [], followUps: [],
        } });
      }
    }
    for (const row of tasks) {
      const parsed = envelopeSchema.safeParse(decode(row.metadata));
      if (!parsed.success || row.channel !== "command" || row.quickAction !== CLAUDE_CUSTOMER_TASK_ACTION) continue;
      const { taskId, task } = parsed.data;
      if (taskId !== Number(row.id) || task.id !== Number(row.id) || !("call" in task)
        || normalizePhone(task.customerPhone) !== phone
        || (task.sessionId === null ? row.sessionId !== null : row.sessionId === null || task.sessionId !== Number(row.sessionId))) continue;
      const entry = entries.find(entry => entry.note.provider === task.call.provider && entry.note.providerCallId === task.call.providerCallId
        && (task.call.provider === "vapi" ? entry.voiceId === task.call.voiceCallId : entry.recordingId === task.call.recordingId));
      if (!entry) continue;
      entry.note.followUps.push(...task.items.map(item => ({ taskId, title: item.title, evidenceQuote: item.evidenceQuote,
        status: item.completedAt !== null || task.status === "done" ? "done" as const : "open" as const })));
      if (task.status === "done" && text(task.completionNote)) {
        entry.note.details.push({ label: "Staff completion note", value: task.completionNote! });
      }
    }
    return { phone, calls: entries.map(entry => entry.note).sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id)).slice(0, 100) };
  } };
}

/** Importing this module does not initialize the application, DB, router, or any transport. */
export async function getLeadCallNotes(input: LeadCallNotesInput): Promise<LeadCallNotesResult> {
  return createLeadCallNotesReader(async () => (await import("./db")).getDb()).read(input);
}
