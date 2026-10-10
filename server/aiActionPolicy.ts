import { sql } from "drizzle-orm";
import { getDb } from "./db";

export type AiActionMode = "approval_required" | "suggest_only" | "automatic";

export interface SmsReplyPolicy {
  actionKey: "send_sms_reply";
  mode: AiActionMode;
  enabled: boolean;
}

export interface SupportTaskPolicy {
  actionKey: "create_support_task";
  mode: AiActionMode;
  enabled: boolean;
}

const DEFAULT_SMS_REPLY_POLICY: SmsReplyPolicy = {
  actionKey: "send_sms_reply",
  mode: "approval_required",
  enabled: true,
};

const DEFAULT_SUPPORT_TASK_POLICY: SupportTaskPolicy = {
  actionKey: "create_support_task",
  mode: "approval_required",
  enabled: true,
};

function parsePolicy(row: { mode?: string; enabled?: number } | undefined): { mode: AiActionMode; enabled: boolean } | null {
  if (!row) return null;
  const mode: AiActionMode = row.mode === "suggest_only" || row.mode === "automatic"
    ? row.mode
    : "approval_required";
  return { mode, enabled: Number(row.enabled ?? 1) === 1 };
}

async function getPolicy(actionKey: string, fallback: { mode: AiActionMode; enabled: boolean }, db?: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const connection = db ?? await getDb();
  if (!connection) return fallback;
  try {
    const [rows] = await connection.execute(sql`
      SELECT mode, enabled
      FROM ai_action_policies
      WHERE merchantId = 'default' AND actionKey = ${actionKey}
      LIMIT 1
    `);
    return parsePolicy((rows as Array<{ mode?: string; enabled?: number }>)[0]) ?? fallback;
  } catch (error) {
    console.warn(`[AI Policy] ${actionKey} unavailable; preserving fail-closed defaults`, error);
    return fallback;
  }
}

export async function getSmsReplyPolicy(db?: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<SmsReplyPolicy> {
  const policy = await getPolicy("send_sms_reply", DEFAULT_SMS_REPLY_POLICY, db);
  return { actionKey: "send_sms_reply", ...policy };
}

export async function getSupportTaskPolicy(db?: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<SupportTaskPolicy> {
  const policy = await getPolicy("create_support_task", DEFAULT_SUPPORT_TASK_POLICY, db);
  return { actionKey: "create_support_task", ...policy };
}
