import { sql } from "drizzle-orm";
import { createClaudeCustomerSmsService, claudeCustomerSmsConfig, isClaudeCustomerSmsPhoneEligible, isClaudeCustomerSmsPilotCustomerOverride, type CustomerSmsInput } from "./claudeCustomerSms";

/** Trusted, post-persistence event entrypoint. Never mounted as a public send
 * endpoint. Existing application and agents are imported only after explicit
 * configuration. Disabled means no DB/provider/model access by this feature. */
export async function dispatchClaudeCustomerSms(input: CustomerSmsInput) {
  if (!claudeCustomerSmsConfig()) return { outcome: "disabled" as const };
  if (!isClaudeCustomerSmsPhoneEligible(input.fromPhone)) return { outcome: "excluded" as const };
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return { outcome: "failed" as const };
  const { createAlternativeSessionReader } = await import("./claudeSmsAlternativeSessionRead");
  const { createReceivingLineReader } = await import("./claudeSmsAlternative");
  const { createClaudeCustomerTasksStore } = await import("./claudeCustomerTasksStore");
  const { generateClaudeCustomerSmsPlan } = await import("./claudeCustomerSmsGeneration");
  const reader = createAlternativeSessionReader({ getDatabase: async () => db });
  const { sendSms } = await import("../openphone");
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
    generate: generateClaudeCustomerSmsPlan,
    store: createClaudeCustomerTasksStore(db, { allowTestCustomer: isClaudeCustomerSmsPilotCustomerOverride }),
    send: sendSms,
    onTaskChange: async () => {
      const { broadcastOpsUpdate } = await import("../sseBroadcast");
      broadcastOpsUpdate("task_update", { channel: "command" });
    },
  });
  return service(input);
}
