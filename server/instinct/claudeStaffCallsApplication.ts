import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import { normalizePhone } from "../utils/phone";
import { createClaudeStaffCallTaskGenerator, createClaudeStaffCallTaskHandler, staffCallSourceSchema, type StaffCallSource } from "./claudeStaffCalls";
import { createClaudeStaffCallsStore } from "./claudeStaffCallsStore";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const object = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const instant = (value: unknown): number | null => typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const rows = (value: unknown): Record<string, any>[] => (value as any)[0];

/** Provider-authenticated data only. A webhook, summary or Whisper role label is not speaker evidence. */
export function staffCallSourceFromRecords(input: {
  callId: string; call: unknown; transcript: unknown; phoneNumbers: unknown; stored: Record<string, any>;
  sessions: Record<string, any>[];
}): StaffCallSource | null {
  const call = object(object(input.call)?.data), transcription = object(object(input.transcript)?.data);
  const lines = object(input.phoneNumbers)?.data;
  const stored = input.stored;
  if (!call || call.id !== input.callId || !/^AC.+$/.test(input.callId) || call.id !== stored.openphoneCallId
    || call.status !== "completed" || call.aiHandled !== null || !["incoming", "outgoing"].includes(call.direction)
    || call.direction !== stored.direction || !Number.isSafeInteger(Number(stored.id)) || Number(stored.id) <= 0
    || !transcription || transcription.callId !== call.id || transcription.status !== "completed"
    || !Array.isArray(transcription.dialogue) || !transcription.dialogue.length || !Array.isArray(lines)) return null;
  const started = instant(call.createdAt), answered = instant(call.answeredAt), ended = instant(call.completedAt);
  const staffUserId = call.direction === "incoming" ? call.answeredBy : call.initiatedBy;
  if (started === null || answered === null || ended === null || ended < answered || answered < started
    || typeof staffUserId !== "string" || !/^US.+$/.test(staffUserId)) return null;
  const matches = lines.filter(line => line?.id === call.phoneNumberId);
  if (matches.length !== 1) return null;
  const line = matches[0], businessPhone = normalizePhone(line.number);
  if (!businessPhone || !Array.isArray(line.users) || !line.users.some((user: any) => user?.id === staffUserId)) return null;
  const internalPhones = new Set(lines.map(line => normalizePhone(line?.number)).filter(Boolean));
  const participants = Array.isArray(call.participants) ? call.participants.map((phone: unknown) => typeof phone === "string" ? normalizePhone(phone) : null) : [];
  const external = Array.from(new Set(participants.filter((phone: string | null) => phone && !internalPhones.has(phone))));
  if (participants.some((phone: string | null) => !phone) || external.length !== 1) return null;
  const callerPhone = external[0] as string;
  if (callerPhone !== normalizePhone(stored.callerPhone)) return null;
  const staffIds = new Set(lines.flatMap(line => Array.isArray(line?.users) ? line.users.map((user: any) => user?.id) : []));
  const customerTurns: string[] = [], transcript: string[] = [];
  let staffSpoke = false, previousStart = -1;
  for (const raw of transcription.dialogue) {
    const turn = object(raw);
    if (!turn || typeof turn.content !== "string" || !turn.content.trim() || typeof turn.start !== "number"
      || typeof turn.end !== "number" || !Number.isFinite(turn.start) || !Number.isFinite(turn.end)
      || turn.start < 0 || turn.end < turn.start || turn.start < previousStart
      || !(turn.identifier === null || typeof turn.identifier === "string")
      || !(turn.userId === null || typeof turn.userId === "string")) return null;
    previousStart = turn.start;
    const phone = turn.identifier ? normalizePhone(turn.identifier) : null;
    const customer = phone === callerPhone && turn.userId === null;
    const staff = typeof turn.userId === "string" && staffIds.has(turn.userId) && phone !== callerPhone;
    // Do not silently drop unattributed speech: its later corrections could change the request.
    if (!customer && !staff) return null;
    if (customer) customerTurns.push(turn.content); else staffSpoke = true;
    transcript.push(`${customer ? "Customer" : "Staff"}: ${turn.content}`);
  }
  if (!customerTurns.length || !staffSpoke) return null;
  // Only a unique exact phone match may supply a name/link. Never select the latest session.
  const matchingSessions = input.sessions.filter(session => normalizePhone(session.leadPhone) === callerPhone);
  // Mirror the existing customer-task classifications, without changing SMS or
  // converting a known team/hiring/internal call into an unlinked customer call.
  if (matchingSessions.some(session => /cleaner|hiring|interview|internal|staff|schedule_confirm/i.test(session.leadSource ?? "")
    || session.csQueue === "Teams" || /^INTERVIEW_|^SCHEDULE_CONFIRM/.test(session.stage ?? ""))) return null;
  const session = matchingSessions.length === 1 && Number(matchingSessions[0].id) === Number(stored.sessionId)
    && Number.isSafeInteger(Number(stored.sessionId)) && Number(stored.sessionId) > 0 ? matchingSessions[0] : null;
  const recordingUrl = typeof stored.recordingUrl === "string" && /^https:\/\//i.test(stored.recordingUrl) ? stored.recordingUrl : null;
  const parsed = staffCallSourceSchema.safeParse({ recordingId: Number(stored.id), providerCallId: call.id,
    sessionId: session ? Number(session.id) : null, callerPhone, callerName: typeof session?.leadName === "string" ? session.leadName : null,
    receivedAt: started, transcript: transcript.join("\n"), customerTurns, recordingUrl,
    businessPhoneNumberId: call.phoneNumberId, businessPhoneNumber: businessPhone, staffUserId, direction: call.direction });
  return parsed.success ? parsed.data : null;
}

export function createStaffCallSourceReader(options: {
  db: Db; readProvider(path: string): Promise<unknown>;
}) {
  return async (callId: string): Promise<StaffCallSource | null> => {
    if (!/^AC.+$/.test(callId)) return null;
    const saved = rows(await options.db.execute(sql`SELECT id, openphoneCallId, callerPhone, direction, sessionId, recordingUrl FROM openphone_call_recordings WHERE openphoneCallId = ${callId}`));
    if (saved.length !== 1) return null;
    const call = await options.readProvider(`/v1/calls/${encodeURIComponent(callId)}`);
    const verified = object(object(call)?.data);
    if (verified?.id !== callId || verified.status !== "completed" || verified.aiHandled !== null) return null;
    const transcript = await options.readProvider(`/v1/call-transcripts/${encodeURIComponent(callId)}`);
    if (object(object(transcript)?.data)?.status !== "completed") return null;
    const phoneNumbers = await options.readProvider("/v1/phone-numbers");
    const sessions = rows(await options.db.execute(sql`SELECT id, leadPhone, leadName, leadSource, csQueue, stage FROM conversation_sessions WHERE leadPhone = ${saved[0].callerPhone}`));
    return staffCallSourceFromRecords({ callId, call, transcript, phoneNumbers, stored: saved[0], sessions });
  };
}

/** Event-only integration. No startup scan, historical replay, model retry, call or message send. */
export async function handleClaudeStaffCall(callId: string): Promise<void> {
  if (process.env.PREVIEW_MODE === "true" || !/^AC.+$/.test(callId)) return;
  const key = process.env.OPENPHONE_API_KEY;
  if (!key) return;
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("STAFF_CALL_DATABASE_UNAVAILABLE");
  const readSource = createStaffCallSourceReader({ db, readProvider: async path => {
    const response = await fetch(`https://api.openphone.com${path}`, { headers: { Authorization: key, Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("STAFF_CALL_SOURCE_UNAVAILABLE");
    return response.json();
  } });
  const result = await createClaudeStaffCallTaskHandler({ readSource, store: createClaudeStaffCallsStore(db), generate: createClaudeStaffCallTaskGenerator() })(callId);
  if (result.status === "created") {
    const { broadcastOpsUpdate } = await import("../sseBroadcast");
    broadcastOpsUpdate("task_update", { channel: "command" });
  } else if (result.status === "failed") console.error("[Instinct Staff Call Tasks] Processing failed:", result.code);
}

/** No await in the original call handlers, and failures cannot interrupt their existing work. */
export function dispatchClaudeStaffCallEvent(event: unknown): void {
  if (process.env.PREVIEW_MODE === "true") return;
  const envelope = object(event), call = object(object(envelope?.data)?.object);
  const callId = envelope?.type === "call.recording.completed" ? call?.id
    : ["call.transcript.completed", "callTranscript"].includes(envelope?.type) ? call?.callId : null;
  if (typeof callId !== "string" || !/^AC.+$/.test(callId)) return;
  void handleClaudeStaffCall(callId).catch(() => console.error("[Instinct Staff Call Tasks] Call task processing unavailable."));
}
