import { sql } from "drizzle-orm";
import { createClaudeCustomerSmsService, claudeCustomerSmsConfig, isClaudeCustomerSmsPhoneEligible, logClaudeCustomerSmsDiagnostic, type CustomerSmsInput } from "./claudeCustomerSms";

/** Trusted, post-persistence event entrypoint. Never mounted as a public send
 * endpoint. Existing application and agents are imported only after explicit
 * configuration. Disabled means no DB/provider/model access by this feature. */
export async function dispatchClaudeCustomerSms(input: CustomerSmsInput) {
  if (!claudeCustomerSmsConfig()) return { outcome: "disabled" as const };
  if (!isClaudeCustomerSmsPhoneEligible(input.fromPhone)) {
    logClaudeCustomerSmsDiagnostic(input, { stage: "dispatch", outcome: "excluded", reason: "EXCLUDED", exclusion: "PHONE_INELIGIBLE" });
    return { outcome: "excluded" as const };
  }
  let db: Awaited<ReturnType<typeof import("../db")["getDb"]>>;
  try {
    const { getDb } = await import("../db");
    db = await getDb();
  } catch (error) {
    logClaudeCustomerSmsDiagnostic(input, { stage: "database_acquisition", reason: "DATABASE_ACQUISITION_THREW", receiptClaimAttempted: false, generationReached: false, error });
    db = null;
  }
  if (!db) {
    logClaudeCustomerSmsDiagnostic(input, { stage: "database_acquisition", outcome: "failed", reason: "CUSTOMER_REPLY_DATABASE_UNAVAILABLE", receiptClaimAttempted: false, generationReached: false });
    await notifyCustomerSmsFailure({ taskId: null, code: "CUSTOMER_REPLY_DATABASE_UNAVAILABLE", sessionId: input.sessionId });
    return { outcome: "failed" as const };
  }
  const { createAlternativeSessionReader } = await import("./claudeSmsAlternativeSessionRead");
  const { createReceivingLineReader } = await import("./claudeSmsAlternative");
  const { createClaudeCustomerTasksStore } = await import("./claudeCustomerTasksStore");
  const { createClaudeCustomerSmsGeneratorWithReply } = await import("./claudeCustomerSmsGeneration");
  const { runInitialLeadDraft } = await import("./claudeAgentClient");
  const { createSmsBookingQuoteReplyGenerator } = await import("./smsBookingQuoteGeneration");
  const { createSmsBookingQuoteStore } = await import("./smsBookingQuoteStore");
  const { createSmsBookingQuotePlanPreparer } = await import("./smsBookingQuoteApplication");
  const reader = createAlternativeSessionReader({ getDatabase: async () => db });
  const { createSmsCustomerRecordsReader } = await import("./smsCustomerRecords");
  const { readVoiceCustomerBookingContext } = await import("./voiceCustomerBookingLookup");
  const readCustomerRecords = createSmsCustomerRecordsReader(db, readVoiceCustomerBookingContext);
  const { sendSms } = await import("../openphone");
  const { recordSmsQualityComplaintInBackground } = await import("../teamQualitySignals");
  const quoteStore = createSmsBookingQuoteStore(db);
  let linkPrepared = false;
  const taskStore = createClaudeCustomerTasksStore(db, {
    preparePlan: createSmsBookingQuotePlanPreparer(quoteStore, Date.now, () => { linkPrepared = true; }),
  });
  const service = createClaudeCustomerSmsService({
    config: claudeCustomerSmsConfig,
    readSession: async id => {
      const context = await reader(id);
      if (!context) return null;
      const [rows] = await db.execute(sql`SELECT leadSource, smsOptOut, csQueue FROM conversation_sessions WHERE id = ${id}`) as any;
      if (!Array.isArray(rows) || rows.length !== 1) return null;
      return { ...context, leadSource: rows[0].leadSource, smsOptOut: rows[0].smsOptOut, csQueue: rows[0].csQueue };
    },
    readReceivingLine: id => readReceivingLineWithRetry(input, id, createReceivingLineReader),
    generate: (binding, session, signal) => createClaudeCustomerSmsGeneratorWithReply(createSmsBookingQuoteReplyGenerator({
      signal,
      smsBookingQuote: { readState: quoteStore.read },
      readCustomerRecords: readCustomerRecords,
      runner: options => runInitialLeadDraft({ ...options, cacheTtl: "1h", signal }),
      // Phase 2: save the optional complaint label in the background; never awaited by the reply.
      onQualityComplaint: (complaint, generated) => recordSmsQualityComplaintInBackground(complaint, generated),
    }))(binding, session),
    store: { ...taskStore, prepare: async (claim, plan, failure) => {
      linkPrepared = false;
      const prepared = await taskStore.prepare(claim, plan, failure);
      if (prepared && linkPrepared) {
        // The existing task/reply transaction has committed before any refresh.
        try {
          const { broadcastOpsUpdate } = await import("../sseBroadcast");
          broadcastOpsUpdate("booking_funnel_update");
        } catch { /* Refresh failure never changes the durable reply/send outcome. */ }
      }
      return prepared;
    } },
    send: sendSms,
    onFailure: notifyCustomerSmsFailure,
    onTaskChange: async () => {
      const { broadcastOpsUpdate } = await import("../sseBroadcast");
      broadcastOpsUpdate("task_update", { channel: "command" });
    },
  });
  return service(input);
}

// ── Receiving-line lookup: the same single OpenPhone request, bounded ───────
// Each request is limited to 10 s. A temporary failure (rate limit, server error, timeout, network)
// is retried once: after Retry-After when OpenPhone sends one that fits the 5 s window (no retry if
// it asks for longer), otherwise after 1.5 s. The real failure is logged; nothing else changes.
export const RECEIVING_LINE_TIMEOUT_MS = 10_000;
export const RECEIVING_LINE_RETRY_DELAY_MS = 1_500;
export const RECEIVING_LINE_MAX_RETRY_WAIT_MS = 5_000;
const TEMPORARY_LINE_FAILURE = /^(HTTP_(408|425|429|5\d\d)|TIMEOUT|NETWORK_ERROR)$/;
/** Retry-After as milliseconds (seconds or HTTP date); null when absent or unreadable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
type LineReaderFactory = (options: { request: typeof fetch }) => (phoneNumberId: string) => Promise<string>;
export async function readReceivingLineWithRetry(input: CustomerSmsInput, phoneNumberId: string, createReader: LineReaderFactory,
  deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; apiKeyPresent?: () => boolean } = {}): Promise<string> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    let failure = "LOOKUP_REJECTED";   // OpenPhone answered, but not with exactly one valid number for this line
    let waitMs: number | null = null;
    const read = createReader({ request: (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      try {
        const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(RECEIVING_LINE_TIMEOUT_MS) });
        if (!response.ok) { failure = `HTTP_${response.status}`; waitMs = retryAfterMs(response.headers.get("retry-after")); }
        return response;
      } catch (error) {
        failure = (error as { name?: string })?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR";
        throw error;
      }
    }) as typeof fetch });
    try { return await read(phoneNumberId); }
    catch (error) {
      if (!(deps.apiKeyPresent ?? (() => !!process.env.OPENPHONE_API_KEY?.trim()))()) failure = "NO_API_KEY";
      const delay = waitMs === null ? RECEIVING_LINE_RETRY_DELAY_MS : waitMs;
      const retry = attempt === 1 && TEMPORARY_LINE_FAILURE.test(failure) && delay <= RECEIVING_LINE_MAX_RETRY_WAIT_MS;
      logClaudeCustomerSmsDiagnostic(input, { stage: "receiving_line_read", reason: `RECEIVING_LINE_${failure}${retry ? "_RETRYING" : ""}`,
        receiptClaimAttempted: false, generationReached: false });
      if (!retry) throw error;
      await sleep(delay);
    }
  }
}

async function notifyCustomerSmsFailure(detail: { taskId: number | null; code: string; sessionId: number }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delivered = false;
  try {
    const alert = async () => {
      const { notifyOwner } = await import("../_core/notification");
      return notifyOwner({ title: "Customer SMS needs staff review", content: `Session ${detail.sessionId}. ${detail.taskId === null ? "Staff task could not be saved; review the conversation manually." : `Task ${detail.taskId}. Review the existing customer task before following up.`} ${detail.code}.` });
    };
    delivered = await Promise.race([alert(), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 10_000); })]);
  } catch { /* Notification failure must not escape the original explicit failed outcome. */ }
  finally { if (timer) clearTimeout(timer); }
  if (!delivered) console.warn("[ClaudeCustomerSMS] Owner alert unavailable", detail);
}
