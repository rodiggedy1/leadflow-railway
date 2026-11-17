import { sql, type SQL } from "drizzle-orm";
import { CLAUDE_CUSTOMER_REPLY_CAPABILITY, CLAUDE_CUSTOMER_TASK_ACTION } from "../../shared/claudeCustomerTasks";
import { CUSTOMER_EMAIL_RECEIPT_ACTION } from "./claudeCustomerEmail";
import { normalizePhone } from "../utils/phone";
import { claudeCustomerSmsConfig, isClaudeCustomerSmsPhoneEligible } from "./claudeCustomerSms";

interface GuardDatabase { transaction<T>(fn: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>): Promise<T>; execute(query: SQL): Promise<unknown> }
const rows = (result: unknown): any[] => (result as any)[0];
export interface CustomerReplyGuardOptions { getDatabase?: () => Promise<GuardDatabase | null> }
export function createClaudeCustomerReplyGuards(options: CustomerReplyGuardOptions = {}) {
  const getDatabase = options.getDatabase ?? (async () => (await import("../db")).getDb());
  return {
    async taskCard(messageId: number): Promise<void> {
      const db = await getDatabase();
      if (!db) throw new Error("CUSTOMER_REPLY_STATUS_UNAVAILABLE");
      const [record] = rows(await db.execute(sql`SELECT quickAction FROM ops_chat_messages WHERE id = ${messageId}`));
      if (record?.quickAction === CLAUDE_CUSTOMER_TASK_ACTION || record?.quickAction === CUSTOMER_EMAIL_RECEIPT_ACTION) throw new Error("CUSTOMER_TASK_CARD_PROTECTED");
    },
    async legacyDraft(draftId: number): Promise<void> {
      const db = await getDatabase();
      if (!db) throw new Error("CUSTOMER_REPLY_STATUS_UNAVAILABLE");
      const [record] = rows(await db.execute(sql`SELECT capability FROM madison_sms_drafts WHERE id = ${draftId}`));
      if (record?.capability === CLAUDE_CUSTOMER_REPLY_CAPABILITY) throw new Error("CUSTOMER_REPLY_RECEIPT_PROTECTED");
    },
    async humanSend(input: { sessionId?: number; phone?: string }): Promise<void> {
      if (!claudeCustomerSmsConfig()) return;
      if (input.phone !== undefined && !isClaudeCustomerSmsPhoneEligible(input.phone)) return;
      if (input.sessionId === undefined && input.phone === undefined) return;
      const db = await getDatabase();
      if (!db) throw new Error("CUSTOMER_REPLY_STATUS_UNAVAILABLE");
      await db.transaction(async tx => {
        let phone = input.phone ? normalizePhone(input.phone) : null;
        if (input.sessionId !== undefined) {
          const sessions = rows(await tx.execute(sql`SELECT leadPhone FROM conversation_sessions WHERE id = ${input.sessionId}`));
          if (sessions.length !== 1 || !isClaudeCustomerSmsPhoneEligible(sessions[0]?.leadPhone)) return;
          const [session] = sessions;
          phone = normalizePhone(session?.leadPhone);
        }
        if (!phone || !isClaudeCustomerSmsPhoneEligible(phone)) return;
        // Destination arbitration is not customer identity resolution: do not
        // select or merge any other session. Both existing human send forms can
        // prevent a duplicate automatic reply to this exact destination.
        const records = rows(await tx.execute(sql`SELECT id, status FROM madison_sms_drafts
          WHERE capability = ${CLAUDE_CUSTOMER_REPLY_CAPABILITY} AND fromPhone = ${phone}
            AND status IN ('TOOLS_RUNNING', 'SENDING') FOR UPDATE`));
        if (records.some(record => record.status === "SENDING")) throw new Error("CUSTOMER_REPLY_IN_FLIGHT_OR_UNCERTAIN");
        for (const record of records) await tx.execute(sql`UPDATE madison_sms_drafts
          SET status = 'DISMISSED', errorCode = 'HUMAN_REPLY_WON', updatedAt = NOW(3)
          WHERE id = ${record.id} AND capability = ${CLAUDE_CUSTOMER_REPLY_CAPABILITY} AND status = 'TOOLS_RUNNING'`);
      });
    },
  };
}
const applicationGuards = createClaudeCustomerReplyGuards();
export const guardClaudeCustomerLegacyDraftAction = applicationGuards.legacyDraft;
export const guardClaudeCustomerManualSend = applicationGuards.humanSend;
export const guardClaudeCustomerTaskCardAction = applicationGuards.taskCard;
