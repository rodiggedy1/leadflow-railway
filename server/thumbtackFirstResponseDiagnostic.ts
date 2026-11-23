import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { getDb } from "./db";
import { capturedThumbtackLead, thumbtackFirstResponseConfig, thumbtackFirstResponseKey,
  THUMBTACK_ACCOUNT, THUMBTACK_FIRST_RESPONSE_CAPABILITY } from "./instinct/claudeThumbtackFirstResponse";
import { thumbtackFirstResponseIsRelay } from "./instinct/claudeThumbtackFirstResponseRelay";

type Db = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "execute">;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const code = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,128}$/.test(value) ? value : null;
const messageIdPresent = (value: unknown) => typeof value === "string" && Boolean(value.trim()) && value !== "null";
const id = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
function databaseCode(error: unknown): string {
  for (let current: any = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (typeof current.code === "string" && /^(?:ER_[A-Z0-9_]+|ECONNRESET|ECONNREFUSED|ETIMEDOUT)$/.test(current.code)) return current.code;
  }
  return "READ_FAILED";
}

/** Passive point lookups only. Never import the dispatcher, generator, sender or store. */
export async function readThumbtackFirstResponseDiagnostic(db: Db | null, captureId: number, env: NodeJS.ProcessEnv = process.env) {
  if (!Number.isSafeInteger(captureId) || captureId <= 0) throw new Error("INVALID_CAPTURE_ID");
  const config = thumbtackFirstResponseConfig(env);
  const relay = thumbtackFirstResponseIsRelay(env);
  const result = {
    captureId,
    readOnly: true,
    configuration: {
      observedAt: new Date().toISOString(),
      enabledFlag: env.THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED === "true",
      senderIdPresent: Boolean(env.OPENPHONE_PHONE_NUMBER_ID?.trim()),
      smsApiKeyPresent: Boolean(env.OPENPHONE_API_KEY?.trim()),
      modelApiKeyPresent: Boolean(env.OPENAI_API_KEY?.trim()),
      nativeConfigAvailable: Boolean(config),
      dispatchMode: relay ? "relay" : config ? "native_ai" : "legacy",
      runtimeCommit: /^[a-f0-9]{40}$/i.test(env.RAILWAY_GIT_COMMIT_SHA ?? "") ? env.RAILWAY_GIT_COMMIT_SHA : null,
      appliesAt: "diagnostic_request_not_original_arrival",
    },
    capture: null as null | { source: string | null; eventType: string | null; receivedAt: unknown; processed: boolean | null; processedAt: unknown },
    projection: null as null | { accepted: boolean; validPhone: boolean; phoneLast4: string | null; negotiationId: string | null },
    receipts: [] as Array<Record<string, unknown>>,
    failureNotices: [] as Array<Record<string, unknown>>,
    evidence: {
      introductionAttemptRecorded: null as boolean | null,
      providerAcceptanceRecorded: false,
      firstRecordedFailure: null as null | { stage: string | null; code: string | null },
      conclusion: "READ_NOT_COMPLETED",
    },
    limitations: [
      "Capture storage and processed status do not identify the receiving hostname or prove SMS delivery.",
      "Current configuration does not prove configuration at the original arrival.",
      "No matching receipt or failure notice means no durable attempt evidence, not proof that dispatch never ran.",
      "Only exact current intake/introduction keys and the legacy phone key are checked; older alternative keys and runtime logs are not searched.",
      "Error codes are retained evidence; an exception discarded by the original handler cannot be recovered here.",
    ],
    readError: null as null | { stage: string; code: string },
  };
  if (!db) {
    result.readError = { stage: "database", code: "DATABASE_UNAVAILABLE" };
    return result;
  }
  const read = async (stage: string, query: Parameters<Db["execute"]>[0]): Promise<any[] | null> => {
    try {
      const response = await db.execute(query);
      const rows = (response as any)[0];
      if (!Array.isArray(rows)) throw new Error("INVALID_READ_RESULT");
      return rows;
    } catch (error) {
      result.readError = { stage, code: databaseCode(error) };
      return null;
    }
  };
  const captures = await read("capture", sql`SELECT id, source, event_type, created_at, processed, processed_at, raw_payload
    FROM webhook_events WHERE id = ${captureId} LIMIT 1`);
  if (!captures) return result;
  const capture = captures[0];
  if (!capture) {
    result.evidence.conclusion = "CAPTURE_NOT_FOUND";
    return result;
  }
  result.capture = { source: code(capture.source), eventType: code(capture.event_type), receivedAt: capture.created_at,
    processed: capture.processed == null ? null : Number(capture.processed) === 1, processedAt: capture.processed_at ?? null };
  const lead = capturedThumbtackLead({ id: captureId, source: capture.source, eventType: capture.event_type,
    receivedAt: new Date(capture.created_at), rawPayload: capture.raw_payload }, config ?? { startAt: 0, fromNumberId: "diagnostic_only" });
  result.projection = { accepted: Boolean(lead), validPhone: Boolean(lead?.phone), phoneLast4: lead?.phone?.slice(-4) ?? null,
    negotiationId: lead?.native.negotiationId ?? null };
  // A pre-projection failure is keyed to the capture; later failures use the native lead key.
  const noticeKeys = [`claude-native-failure:v1:${hash(`capture:${captureId}`)}`];
  if (lead) {
    noticeKeys.push(`claude-native-failure:v1:${hash(lead.key)}`);
    const intakeKey = "tt-intake:v1:" + hash(JSON.stringify(["thumbtack", THUMBTACK_ACCOUNT, lead.native.negotiationId, lead.phone]));
    const keys = [intakeKey, lead.key, ...(lead.phone ? [thumbtackFirstResponseKey(lead.phone)] : [])];
    const receipts = await read("native_receipts", sql`SELECT id, sessionId, capability, status, errorStage, errorCode,
      outboundOpenPhoneId, sentAt, deliveredAt, createdAt,
      (generatedDraft IS NOT NULL AND LENGTH(TRIM(generatedDraft)) > 0) AS hasGeneratedDraft,
      JSON_UNQUOTE(JSON_EXTRACT(resolvedContext, '$.negotiationId')) AS negotiationId,
      JSON_UNQUOTE(JSON_EXTRACT(capabilityResult, '$.phase')) AS phase,
      JSON_UNQUOTE(JSON_EXTRACT(capabilityResult, '$.messageId')) AS stateMessageId,
      JSON_UNQUOTE(JSON_EXTRACT(capabilityResult, '$.provider.messageId')) AS providerMessageId,
      JSON_UNQUOTE(JSON_EXTRACT(capabilityResult, '$.provider.providerStatus')) AS providerStatus
      FROM madison_sms_drafts WHERE inboundOpenPhoneId IN (${sql.join(keys.map(key => sql`${key}`), sql`, `)})
      AND capability IN (${"thumbtack_lead_intake_v1"}, ${THUMBTACK_FIRST_RESPONSE_CAPABILITY}) ORDER BY id ASC LIMIT 3`);
    if (!receipts) return result;
    result.receipts = receipts.filter(row => row.negotiationId === lead.native.negotiationId).map(row => ({
      id: id(row.id), sessionId: id(row.sessionId), capability: code(row.capability), status: code(row.status),
      phase: code(row.phase), hasGeneratedDraft: Number(row.hasGeneratedDraft) === 1,
      providerAcceptanceRecorded: [row.outboundOpenPhoneId, row.stateMessageId, row.providerMessageId].some(messageIdPresent),
      providerStatus: code(row.providerStatus), sentAt: row.sentAt ?? null, deliveredAt: row.deliveredAt ?? null,
      errorStage: code(row.errorStage), errorCode: code(row.errorCode),
    }));
  }
  const notices = await read("failure_notices", sql`SELECT id,
    JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.responseFailure.captureId')) AS failureCaptureId,
    JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.responseFailure.workflow')) AS workflow,
    JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.responseFailure.stage')) AS stage,
    JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.responseFailure.code')) AS code,
    JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.responseFailure.uncertain')) AS uncertain
    FROM ops_chat_messages WHERE activeDedupKey IN (${sql.join(noticeKeys.map(key => sql`${key}`), sql`, `)})
    ORDER BY id ASC LIMIT 2`);
  if (!notices) return result;
  result.failureNotices = notices.filter(row => Number(row.failureCaptureId) === captureId && row.workflow === "thumbtack_first_response")
    .map(row => ({ id: id(row.id), stage: code(row.stage), code: code(row.code), uncertain: row.uncertain === "true" }));
  const introduction = result.receipts.find(row => row.capability === THUMBTACK_FIRST_RESPONSE_CAPABILITY);
  result.evidence.introductionAttemptRecorded = introduction || result.failureNotices.length ? true : null;
  result.evidence.providerAcceptanceRecorded = introduction?.providerAcceptanceRecorded === true;
  const failure = result.failureNotices[0] ?? result.receipts.find(row => row.errorCode);
  if (failure) result.evidence.firstRecordedFailure = {
    stage: code(failure.stage ?? failure.errorStage), code: code(failure.code ?? failure.errorCode),
  };
  result.evidence.conclusion = failure ? "RECORDED_FAILURE" : result.evidence.providerAcceptanceRecorded ? "PROVIDER_ACCEPTANCE_RECORDED_NOT_DELIVERY_PROOF"
    : introduction ? "INTRODUCTION_RECEIPT_FOUND" : "NO_DURABLE_INTRODUCTION_ATTEMPT_EVIDENCE";
  return result;
}
