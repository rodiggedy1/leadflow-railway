import type { CustomerReplyPlan } from "../../shared/claudeCustomerTasks";

export const CUSTOMER_EMAIL_RECEIPT_ACTION = "claude_customer_email_receipt" as const;
export const CUSTOMER_EMAIL_RECEIPT_CHANNEL = "instinct_email_receipts" as const;
export interface CustomerEmailTurn {
  id: string; threadId: string; fromEmail: string; fromName: string; to: string;
  replyToEmail: string | null; subject: string; text: string; html: string;
  createdAt: number; headers: Record<string, string>; labelIds: string[];
}
export interface CustomerEmailSnapshot {
  mailboxEmail: string; threadId: string; messages: CustomerEmailTurn[];
}
export interface CustomerEmailBinding {
  mailboxEmail: string; threadId: string; inboundMessageId: string;
  fromEmail: string; replyToEmail: string | null; recipientEmail: string;
  senderName: string | null; subject: string; rfcMessageId: string;
  createdAt: number; receivedAt: number; inboundText: string;
  snapshotHash: string; snapshot: CustomerEmailSnapshot;
}
export interface CustomerEmailClaim { receiptId: number; key: string; binding: CustomerEmailBinding }
export interface CustomerEmailStore {
  claim(binding: CustomerEmailBinding): Promise<CustomerEmailClaim | null>;
  prepare(claim: CustomerEmailClaim, plan: CustomerReplyPlan): Promise<boolean>;
  recordAcceptance(claim: CustomerEmailClaim, messageId: string): Promise<boolean>;
  markUncertain(claim: CustomerEmailClaim): Promise<void>;
  suppress(claim: CustomerEmailClaim, code: string): Promise<void>;
  guardHumanReply(threadId: string): Promise<void>;
  ownsThread(threadId: string): Promise<boolean>;
}
export interface CustomerEmailConfig { enabled: boolean; startAt: number }
export function readCustomerEmailConfig(env: NodeJS.ProcessEnv = process.env): CustomerEmailConfig {
  const raw = env.CLAUDE_CUSTOMER_EMAIL_START_AT;
  const startAt = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(raw) ? Date.parse(raw) : NaN;
  return { enabled: env.CLAUDE_CUSTOMER_EMAIL_ENABLED === "true" && Number.isFinite(startAt), startAt };
}
export interface CustomerEmailPorts {
  readConfig(): CustomerEmailConfig;
  store: CustomerEmailStore;
  readCurrent(binding: CustomerEmailBinding): Promise<boolean>;
  generate(binding: CustomerEmailBinding): Promise<CustomerReplyPlan>;
  send(binding: CustomerEmailBinding, replyText: string): Promise<{ messageId: string; threadId: string }>;
  broadcast?(): Promise<void> | void;
}
/** One immutable incoming email owns one response; no retry or booking authority. */
export async function dispatchClaudeCustomerEmail(binding: CustomerEmailBinding, ports: CustomerEmailPorts): Promise<string> {
  const config = ports.readConfig();
  if (!config.enabled || binding.createdAt < config.startAt || binding.receivedAt < config.startAt
    || !Number.isFinite(binding.createdAt) || !Number.isFinite(binding.receivedAt) || binding.createdAt > binding.receivedAt) return "ineligible";
  const claim = await ports.store.claim(binding);
  if (!claim) return "duplicate";
  let submitted = false;
  const broadcast = async () => { try { await ports.broadcast?.(); } catch { /* Visibility cannot change send disposition. */ } };
  try {
    const plan = await ports.generate(claim.binding);
    const currentConfig = ports.readConfig();
    if (!currentConfig.enabled || currentConfig.startAt !== config.startAt || !await ports.readCurrent(claim.binding)) {
      await ports.store.suppress(claim, "STALE_EMAIL_OR_DISABLED"); return "suppressed";
    }
    if (!await ports.store.prepare(claim, plan)) { await broadcast(); return "suppressed"; }
    await broadcast();
    // SENDING and the complete exact reply/task are durable before this call.
    submitted = true;
    const result = await ports.send(claim.binding, plan.replyText);
    if (!result?.messageId?.trim() || result.threadId !== claim.binding.threadId) throw new Error("EMAIL_ACCEPTANCE_MISSING_OR_MISMATCHED");
    if (!await ports.store.recordAcceptance(claim, result.messageId)) throw new Error("EMAIL_ACCEPTANCE_SAVE_UNCERTAIN");
    await broadcast(); return "sent"; // Provider acceptance, not delivery.
  } catch {
    if (submitted) { await ports.store.markUncertain(claim); await broadcast(); return "uncertain"; }
    await ports.store.suppress(claim, "EMAIL_PRE_SUBMISSION_FAILED"); await broadcast(); return "suppressed";
  }
}
