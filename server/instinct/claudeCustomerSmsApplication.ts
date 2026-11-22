import { sql } from "drizzle-orm";
import { createClaudeCustomerSmsService, claudeCustomerSmsConfig, isClaudeCustomerSmsPhoneEligible, isClaudeCustomerSmsPilotCustomerOverride, type CustomerSmsInput } from "./claudeCustomerSms";

/** Trusted, post-persistence event entrypoint. Never mounted as a public send
 * endpoint. Existing application and agents are imported only after explicit
 * configuration. Disabled means no DB/provider/model access by this feature. */
export async function dispatchClaudeCustomerSms(input: CustomerSmsInput) {
  if (!claudeCustomerSmsConfig()) return { outcome: "disabled" as const };
  if (!isClaudeCustomerSmsPhoneEligible(input.fromPhone)) return { outcome: "excluded" as const };
  let db: Awaited<ReturnType<typeof import("../db")["getDb"]>>;
  try {
    const { getDb } = await import("../db");
    db = await getDb();
  } catch { db = null; }
  if (!db) {
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
  const { sendSms } = await import("../openphone");
  const quoteStore = createSmsBookingQuoteStore(db);
  let linkPrepared = false;
  const taskStore = createClaudeCustomerTasksStore(db, {
    allowTestCustomer: isClaudeCustomerSmsPilotCustomerOverride,
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
    readReceivingLine: createReceivingLineReader(),
    generate: (binding, session, signal) => createClaudeCustomerSmsGeneratorWithReply(createSmsBookingQuoteReplyGenerator({
      smsBookingQuote: { readState: quoteStore.read },
      runner: options => runInitialLeadDraft({ ...options, signal }),
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
