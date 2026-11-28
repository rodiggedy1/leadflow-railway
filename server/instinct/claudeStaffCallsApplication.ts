import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import { normalizePhone } from "../utils/phone";
import { createClaudeStaffCallTaskGenerator, createClaudeStaffCallTaskHandler, staffCallSourceSchema, type StaffCallSource } from "./claudeStaffCalls";
import { createClaudeStaffCallsStore } from "./claudeStaffCallsStore";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const object = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const instant = (value: unknown): number | null => typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const rows = (value: unknown): Record<string, any>[] => (value as any)[0];

function verifiedCall(callId: string, payload: unknown, stored: Record<string, any>): Record<string, any> | null {
  const call = object(object(payload)?.data);
  if (!call || !/^AC.+$/.test(callId) || call.id !== callId || call.id !== stored.openphoneCallId
    || call.status !== "completed" || call.aiHandled !== null || !["incoming", "outgoing"].includes(call.direction)
    || call.direction !== stored.direction || !Number.isSafeInteger(Number(stored.id)) || Number(stored.id) <= 0
    || typeof call.phoneNumberId !== "string" || !/^PN.+$/.test(call.phoneNumberId)) return null;
  const started = instant(call.createdAt), answered = instant(call.answeredAt), ended = instant(call.completedAt);
  const staffUserId = call.direction === "incoming" ? call.answeredBy : call.initiatedBy;
  if (started === null || answered === null || ended === null || ended < answered || answered < started
    || !(staffUserId === null || typeof staffUserId === "string" && /^US.+$/.test(staffUserId))) return null;
  return call;
}

function transcriptEvidence(native: unknown, stored: Record<string, any>): {
  dialogue: Record<string, any>[]; transcriptSource: "quo" | "saved";
} | null {
  if (native !== null) {
    const transcription = object(object(native)?.data);
    // Present but malformed/wrong-call provider data must never silently use a fallback.
    if (!transcription || transcription.callId !== stored.openphoneCallId) return null;
    if (transcription.dialogue !== undefined) {
      if (!Array.isArray(transcription.dialogue)) return null;
      let previousStart = -1;
      for (const raw of transcription.dialogue) {
        const turn = object(raw);
        if (!turn || typeof turn.content !== "string" || !turn.content.trim() || typeof turn.start !== "number"
          || typeof turn.end !== "number" || !Number.isFinite(turn.start) || !Number.isFinite(turn.end)
          || turn.start < 0 || turn.end < turn.start || turn.start < previousStart
          || !(turn.identifier == null || typeof turn.identifier === "string")
          || !(turn.userId == null || typeof turn.userId === "string")) return null;
        previousStart = turn.start;
      }
    }
    if (transcription.status === "completed") {
      if (!Array.isArray(transcription.dialogue) || !transcription.dialogue.length) return null;
      return { dialogue: transcription.dialogue, transcriptSource: "quo" };
    }
    if (!["absent", "in-progress", "failed", "pending", "processing"].includes(transcription.status)) return null;
  }
  if (typeof stored.transcript !== "string" || !stored.transcript.trim()) return null;
  let dialogue: unknown;
  try { dialogue = JSON.parse(stored.transcript); } catch { return null; }
  if (!Array.isArray(dialogue) || !dialogue.length
    || dialogue.some(raw => !object(raw) || typeof raw.content !== "string" || !raw.content.trim())) return null;
  // The exact saved row authenticates the call, not a speaker. Whisper is not diarized.
  return { dialogue, transcriptSource: "saved" };
}

/** Provider-authenticated call plus exact-row evidence. Saved labels are not speaker proof. */
export function staffCallSourceFromRecords(input: {
  callId: string; call: unknown; transcript: unknown; phoneNumbers: unknown; stored: Record<string, any>;
  sessions: Record<string, any>[];
}): StaffCallSource | null {
  const call = verifiedCall(input.callId, input.call, input.stored);
  const lines = object(input.phoneNumbers)?.data;
  const stored = input.stored;
  if (!call || !Array.isArray(lines)) return null;
  const evidence = transcriptEvidence(input.transcript, stored);
  if (!evidence) return null;
  const staffUserId = call.direction === "incoming" ? call.answeredBy : call.initiatedBy;
  const matches = lines.filter(line => line?.id === call.phoneNumberId);
  if (matches.length !== 1) return null;
  const line = matches[0], businessPhone = typeof line.number === "string" ? normalizePhone(line.number) : null;
  if (!businessPhone) return null;
  const participants = Array.isArray(call.participants) ? call.participants.map((phone: unknown) => typeof phone === "string" ? normalizePhone(phone) : null) : [];
  const counterparts = Array.from(new Set(participants.filter((phone: string | null) => phone && phone !== businessPhone)));
  if (participants.some((phone: string | null) => !phone) || counterparts.length !== 1 || !participants.includes(businessPhone)) return null;
  const callerPhone = counterparts[0] as string;
  if (typeof stored.callerPhone !== "string" || callerPhone !== normalizePhone(stored.callerPhone)) return null;
  const staffIds = new Set(lines.flatMap(line => Array.isArray(line?.users)
    ? line.users.map((user: any) => user?.id).filter((id: unknown) => typeof id === "string" && /^US.+$/.test(id)) : []));
  const evidenceSegments: string[] = [], transcript: string[] = [];
  for (const turn of evidence.dialogue) {
    const phone = typeof turn.identifier === "string" ? normalizePhone(turn.identifier) : null;
    const caller = evidence.transcriptSource === "quo" && phone === callerPhone && turn.userId === null;
    const staff = evidence.transcriptSource === "quo" && typeof turn.userId === "string" && staffIds.has(turn.userId)
      && phone !== callerPhone;
    evidenceSegments.push(turn.content);
    transcript.push(`${caller ? "Caller" : staff ? "Staff" : "Unattributed"}: ${turn.content}`);
  }
  // Only a unique exact phone match may supply a name/link. Never select the latest session.
  const matchingSessions = input.sessions.filter(session => typeof session.leadPhone === "string" && normalizePhone(session.leadPhone) === callerPhone);
  const session = matchingSessions.length === 1 && Number(matchingSessions[0].id) === Number(stored.sessionId)
    && Number.isSafeInteger(Number(stored.sessionId)) && Number(stored.sessionId) > 0 ? matchingSessions[0] : null;
  const recordingUrl = typeof stored.recordingUrl === "string" && /^https:\/\//i.test(stored.recordingUrl) ? stored.recordingUrl : null;
  const parsed = staffCallSourceSchema.safeParse({ recordingId: Number(stored.id), providerCallId: call.id,
    sessionId: session ? Number(session.id) : null, callerPhone, callerName: typeof session?.leadName === "string" ? session.leadName : null,
    receivedAt: instant(call.createdAt), transcript: transcript.join("\n"), evidenceSegments, recordingUrl,
    transcriptSource: evidence.transcriptSource, evidenceScope: "call_transcript",
    businessPhoneNumberId: call.phoneNumberId, businessPhoneNumber: businessPhone, staffUserId, direction: call.direction });
  return parsed.success ? parsed.data : null;
}

export function createStaffCallSourceReader(options: {
  db: Db; readProvider(path: string): Promise<unknown>;
}) {
  return async (callId: string): Promise<StaffCallSource | null> => {
    if (!/^AC.+$/.test(callId)) return null;
    const saved = rows(await options.db.execute(sql`SELECT id, openphoneCallId, callerPhone, direction, sessionId, recordingUrl, transcript FROM openphone_call_recordings WHERE openphoneCallId = ${callId}`));
    if (saved.length !== 1) return null;
    const call = await options.readProvider(`/v1/calls/${encodeURIComponent(callId)}`);
    if (!verifiedCall(callId, call, saved[0])) return null;
    const transcript = await options.readProvider(`/v1/call-transcripts/${encodeURIComponent(callId)}`);
    if (!transcriptEvidence(transcript, saved[0])) return null;
    const phoneNumbers = await options.readProvider("/v1/phone-numbers");
    const sessions = rows(await options.db.execute(sql`SELECT id, leadPhone, leadName, leadSource, csQueue, stage FROM conversation_sessions WHERE leadPhone = ${saved[0].callerPhone}`));
    return staffCallSourceFromRecords({ callId, call, transcript, phoneNumbers, stored: saved[0], sessions });
  };
}

/** Phase 2: the same staff-call task generation, with the optional quality-complaint label read from the same answer
 * (no extra AI call). The label is saved in the background and never changes the task. */
async function labelledStaffCallTask(source: StaffCallSource) {
  const { createQualityLabelRunner } = await import("./qualityComplaintLabelRunner");
  const label = createQualityLabelRunner();
  const task = await createClaudeStaffCallTaskGenerator({ runner: label.runner })(source);
  try {
    const complaint = label.take(source.transcript);
    if (complaint) (await import("../teamQualitySignals")).recordAiQualityComplaintInBackground(complaint, {
      sourceKey: `call:openphone:${source.providerCallId}`, channel: "call", detector: "claude_staff_call", reportedAtMs: source.receivedAt,
      customerPhone: source.callerPhone, customerName: source.callerName, evidenceText: source.transcript,
      sourceRef: { recordingId: source.recordingId, providerCallId: source.providerCallId } });
  } catch { /* the call task is unaffected */ }
  return task;
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
  const result = await createClaudeStaffCallTaskHandler({ readSource, store: createClaudeStaffCallsStore(db), generate: labelledStaffCallTask })(callId);
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

/** Fresh exact source read after the existing transcript save, never a model retry. */
export function dispatchClaudeStaffCallTranscriptReady(callId: string): void {
  if (process.env.PREVIEW_MODE === "true" || typeof callId !== "string" || !/^AC.+$/.test(callId)) return;
  void handleClaudeStaffCall(callId).catch(() => console.error("[Instinct Staff Call Tasks] Call task processing unavailable."));
}
