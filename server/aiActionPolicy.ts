import { sql } from "drizzle-orm";
import { getDb } from "./db";

export type AiActionMode = "approval_required" | "suggest_only" | "automatic";

export interface SmsReplyPolicy {
  actionKey: "send_sms_reply";
  mode: AiActionMode;
  enabled: boolean;
}

const DEFAULT_SMS_REPLY_POLICY: SmsReplyPolicy = {
  actionKey: "send_sms_reply",
  mode: "approval_required",
  enabled: true,
};

/**
 * Read the merchant policy for SMS sending.
 *
 * This helper deliberately fails closed to the existing approval behavior when
 * the policy table is unavailable during a rolling deployment or on an older
 * environment. It never grants automatic authority as a fallback.
 */
export async function getSmsReplyPolicy(db?: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<SmsReplyPolicy> {
  const connection = db ?? await getDb();
  if (!connection) return DEFAULT_SMS_REPLY_POLICY;

  try {
    const [rows] = await connection.execute(sql`
      SELECT mode, enabled
      FROM ai_action_policies
      WHERE merchantId = 'default' AND actionKey = 'send_sms_reply'
      LIMIT 1
    `);
    const row = (rows as Array<{ mode?: string; enabled?: number }>)[0];
    if (!row) return DEFAULT_SMS_REPLY_POLICY;

    const mode: AiActionMode = row.mode === "suggest_only" || row.mode === "automatic"
      ? row.mode
      : "approval_required";
    return {
      actionKey: "send_sms_reply",
      mode,
      enabled: Number(row.enabled ?? 1) === 1,
    };
  } catch (error) {
    console.warn("[AI Policy] SMS reply policy unavailable; preserving approval-required behavior", error);
    return DEFAULT_SMS_REPLY_POLICY;
  }
}
