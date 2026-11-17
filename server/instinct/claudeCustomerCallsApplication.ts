import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getAssistantId } from "../vapiService";
import { normalizePhone } from "../utils/phone";
import { createClaudeCustomerCallTaskHandler, createClaudeCustomerCallTaskGenerator, type CustomerCallSource } from "./claudeCustomerCalls";
import { createClaudeCustomerCallsStore } from "./claudeCustomerCallsStore";
import { withCallBookingQuoteTask } from "./callBookingQuoteTask";
import { hasSavedCallBookingQuote } from "./callBookingQuoteStore";

const object = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const rows = (value: unknown): Record<string, any>[] => (value as any)[0];
const internalPhones = new Set(["+12028885362", "+19347898077"]);
const missed = new Set(["customer-did-not-answer", "no-answer", "customer-busy", "voicemail", "customer-ended-call-during-greeting"]);

/** Only the authenticated full provider record is call evidence. Webhook text,
 * summary, phone guesses and newest-session selection never establish identity. */
export function customerCallSourceFromRecord(fullValue: unknown, stored: Record<string, any>, callbacks: Record<string, any>[], assistantId: string): CustomerCallSource | null {
  const full = object(fullValue), artifact = object(full?.artifact);
  if (!full || full.id !== stored.vapiCallId || full.type !== "inboundPhoneCall" || full.status !== "ended"
    || !assistantId || full.assistantId !== assistantId || missed.has(full.endedReason)
    || !Number.isSafeInteger(Number(stored.id)) || Number(stored.id) <= 0) return null;
  const messages = artifact?.messages ?? full.messages;
  if (!Array.isArray(messages)) return null;
  const customerTurns = messages.filter(turn => turn?.role === "user" && typeof turn.message === "string" && turn.message.trim()).map(turn => turn.message as string);
  const transcript = typeof artifact?.transcript === "string" && artifact.transcript.trim() ? artifact.transcript
    : typeof full.transcript === "string" && full.transcript.trim() ? full.transcript : null;
  if (!customerTurns.length || !transcript || customerTurns.some(turn => !transcript.includes(turn))) return null;
  const rawPhone = typeof full.customer?.number === "string" ? full.customer.number : "";
  const callerPhone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !callerPhone || callerPhone && internalPhones.has(callerPhone)) return null;
  // Never substitute a model-extracted phone or the newest customer record.
  const storedPhone = normalizePhone(stored.callerPhone);
  if (callerPhone && storedPhone && callerPhone !== storedPhone) return null;
  const boundCallbacks = callbacks.filter(row => Number(row.voiceCallId) === Number(stored.id) && Number(row.completed) === 0
    && (callerPhone === null ? !normalizePhone(row.callerPhone) : normalizePhone(row.callerPhone) === callerPhone)).sort((a, b) => Number(a.id) - Number(b.id));
  const createdAt = new Date(full.endedAt ?? full.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return null;
  const structured = object(object(full.analysis)?.structuredData);
  const sessionId = callerPhone && storedPhone === callerPhone && Number.isSafeInteger(Number(stored.sessionId)) && Number(stored.sessionId) > 0 ? Number(stored.sessionId) : null;
  const recording = artifact?.recordingUrl;
  return { voiceCallId: Number(stored.id), providerCallId: full.id, sessionId,
    callerPhone, callerName: typeof structured?.callerName === "string" && structured.callerName.trim() ? structured.callerName : null,
    receivedAt: createdAt, transcript, customerTurns,
    recordingUrl: typeof recording === "string" && /^https:\/\//i.test(recording) ? recording : null,
    callbackTaskIds: boundCallbacks.map(row => Number(row.id)),
    callbackRequests: boundCallbacks.map(row => ({ id: Number(row.id), notes: typeof row.notes === "string" ? row.notes : null,
      preferredCallbackTime: typeof row.preferredCallbackTime === "string" ? row.preferredCallbackTime : null })),
  };
}

export interface CustomerCallSourceReaderOptions {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  fetchCall: (id: string) => Promise<unknown>;
  assistantId: string;
}
export function createCustomerCallSourceReader({ db, fetchCall, assistantId }: CustomerCallSourceReaderOptions) {
  return async (report: unknown): Promise<CustomerCallSource | null> => {
    const message = object(object(report)?.message), call = object(message?.call);
    if (message?.type !== "end-of-call-report" || typeof call?.id !== "string" || !call.id.trim()) return null;
    const matches = rows(await db.execute(sql`SELECT * FROM voice_calls WHERE vapiCallId = ${call.id}`));
    if (matches.length !== 1) return null;
    if (rows(await db.execute(sql`SELECT id FROM field_mgmt_calls WHERE vapiCallId = ${call.id}`)).length) return null;
    const full = await fetchCall(call.id);
    const callbacks = rows(await db.execute(sql`SELECT * FROM callback_tasks WHERE voiceCallId = ${Number(matches[0].id)} ORDER BY id`));
    return customerCallSourceFromRecord(full, matches[0], callbacks, assistantId);
  };
}

/** Called only by the existing completed-call webhook flow. Preview cannot
 * invoke this live model path. Factory/unit seams never execute the app. */
export async function handleClaudeCustomerCallReport(report: unknown): Promise<void> {
  if (process.env.PREVIEW_MODE === "true") return;
  const key = process.env.VAPI_PRIVATE_KEY, assistantId = getAssistantId();
  if (!key || !assistantId) { console.warn("[Instinct Call Tasks] Call source credentials or customer assistant identity unavailable."); return; }
  const db = await getDb();
  if (!db) throw new Error("CUSTOMER_CALL_DATABASE_UNAVAILABLE");
  const readSource = createCustomerCallSourceReader({ db, assistantId, fetchCall: async id => {
    const response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error("CUSTOMER_CALL_SOURCE_UNAVAILABLE");
    return response.json();
  } });
  const result = await createClaudeCustomerCallTaskHandler({ readSource, store: createClaudeCustomerCallsStore(db),
    generate: withCallBookingQuoteTask({ generate: createClaudeCustomerCallTaskGenerator(), hasSavedQuote: callId => hasSavedCallBookingQuote(db, callId) }) })(report);
  if (result.status === "created") {
    const { broadcastOpsUpdate } = await import("../sseBroadcast");
    broadcastOpsUpdate("task_update", { channel: "command" });
  } else if (result.status === "failed") {
    console.error("[Instinct Call Tasks] Task processing failed:", result.code);
  }
}
